import { useCallback, useEffect, useRef, useState } from 'react';

// Minimal shape of the browser SpeechRecognition API we rely on. The DOM
// lib typings for it live behind a vendor-prefixed global that TypeScript
// doesn't include by default, so we declare only the surface we touch.
interface SpeechRecognitionAlternative {
  readonly transcript: string;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onend: ((this: SpeechRecognitionLike, ev: Event) => unknown) | null;
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => unknown) | null;
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionEventLike) => unknown) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// A recognition session that ends this soon after starting, repeatedly, is a
// broken device rather than a user pausing — bail out instead of respawning
// sessions forever.
const RESTART_BURST_WINDOW_MS = 1000;
const MAX_RESTARTS_PER_WINDOW = 5;

// Errors that mean another restart cannot possibly succeed.
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

export interface UseSpeechRecognitionOptions {
  lang?: string;
  // Keep listening until the caller stops, rather than ending after the first
  // phrase. Browsers still end a session on their own silence timeout, so the
  // hook restarts it transparently — see the onend handler.
  continuous?: boolean;
  // Emit partial results as the user speaks (useful for a live-preview UI).
  // Set false to only emit finalized chunks after each phrase.
  interimResults?: boolean;
  // Called for every final chunk. `text` is a single phrase, already trimmed.
  onFinalResult?: (text: string) => void;
  // Called with the running interim transcript while the user is still speaking.
  // Cleared automatically when a final chunk arrives or listening stops.
  onInterimResult?: (text: string) => void;
  // Called on any recognition error. `error` matches SpeechRecognitionErrorEvent.error.
  onError?: (error: string) => void;
}

export interface UseSpeechRecognitionResult {
  isSupported: boolean;
  isListening: boolean;
  interimTranscript: string;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

/**
 * Wraps the browser Web Speech API for dictation that stays live until the
 * caller stops it. Designed as a building block for both the chat mic button
 * and a future back-and-forth voice mode — start/stop are explicit so the
 * caller can later drive them from turn detection instead of a tap.
 */
export function useSpeechRecognition(opts: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionResult {
  const { lang = 'en-US', continuous = true, interimResults = true, onFinalResult, onInterimResult, onError } = opts;

  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // The user's intent, as opposed to whether a session happens to be running.
  // A browser silence timeout ends the session without ending the intent, and
  // that gap is exactly what the auto-restart below covers.
  const shouldListenRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartBurstRef = useRef({ count: 0, since: 0 });
  // Keep callbacks in refs so we can hand them to a single long-lived
  // recognition instance without re-creating it on every parent render.
  const onFinalResultRef = useRef(onFinalResult);
  const onInterimResultRef = useRef(onInterimResult);
  const onErrorRef = useRef(onError);
  useEffect(() => { onFinalResultRef.current = onFinalResult; }, [onFinalResult]);
  useEffect(() => { onInterimResultRef.current = onInterimResult; }, [onInterimResult]);
  useEffect(() => { onErrorRef.current = onError; }, [onError]);

  useEffect(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setIsSupported(false);
      return;
    }
    setIsSupported(true);

    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = interimResults;
    rec.continuous = continuous;
    rec.maxAlternatives = 1;

    const clearRestartTimer = () => {
      if (restartTimerRef.current !== null) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
    };

    const giveUp = (reason?: string) => {
      shouldListenRef.current = false;
      clearRestartTimer();
      setIsListening(false);
      setInterimTranscript('');
      if (reason) onErrorRef.current?.(reason);
    };

    rec.onstart = () => setIsListening(true);

    rec.onend = () => {
      setInterimTranscript('');
      if (!shouldListenRef.current) {
        setIsListening(false);
        return;
      }

      // Browsers end the session on their own silence timeout even with
      // continuous = true, so "keep listening until I tap again" has to be
      // implemented by starting a fresh session. isListening deliberately
      // stays true across the gap so the mic button doesn't flicker.
      const now = Date.now();
      const burst = restartBurstRef.current;
      if (now - burst.since > RESTART_BURST_WINDOW_MS) {
        burst.since = now;
        burst.count = 0;
      }
      burst.count += 1;
      if (burst.count > MAX_RESTARTS_PER_WINDOW) {
        giveUp('restart-loop');
        return;
      }

      // Deferred rather than called inline: Chrome throws InvalidStateError
      // for a start() issued from within its own onend.
      clearRestartTimer();
      restartTimerRef.current = setTimeout(() => {
        restartTimerRef.current = null;
        if (!shouldListenRef.current) return;
        try {
          rec.start();
        } catch {
          giveUp();
        }
      }, 0);
    };

    rec.onerror = (ev) => {
      // "aborted" and "no-speech" are normal outcomes when the user taps the
      // mic to cancel or simply pauses — don't surface them, and let onend
      // decide whether to resume. Anything fatal ends the session for good;
      // restarting into a denied microphone would just spin.
      if (FATAL_ERRORS.has(ev.error)) {
        giveUp(ev.error);
        return;
      }
      if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
        onErrorRef.current?.(ev.error);
        giveUp();
      }
    };
    rec.onresult = (ev) => {
      // Audio is reaching us, so whatever restarts got us here were healthy
      // gaps rather than a failing device.
      restartBurstRef.current = { count: 0, since: Date.now() };
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          const trimmed = transcript.trim();
          if (trimmed) onFinalResultRef.current?.(trimmed);
        } else {
          interim += transcript;
        }
      }
      setInterimTranscript(interim);
      onInterimResultRef.current?.(interim);
    };

    recognitionRef.current = rec;
    return () => {
      // Drop the intent before detaching handlers, so a pending restart can't
      // outlive the component and leave the microphone open.
      shouldListenRef.current = false;
      clearRestartTimer();
      rec.onstart = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onresult = null;
      try {
        rec.abort();
      } catch {
        // Some browsers throw if abort is called before start; safe to ignore.
      }
      recognitionRef.current = null;
    };
  }, [lang, continuous, interimResults]);

  const start = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec || isListening) return;
    shouldListenRef.current = true;
    restartBurstRef.current = { count: 0, since: Date.now() };
    try {
      rec.start();
    } catch (e) {
      // Chrome throws InvalidStateError if start() is called while already
      // running — recover by aborting and retrying on the next tick.
      shouldListenRef.current = false;
      try { rec.abort(); } catch { /* noop */ }
      onErrorRef.current?.(e instanceof Error ? e.message : 'start-failed');
    }
  }, [isListening]);

  const stop = useCallback(() => {
    // Clear the intent first: the stop() below fires onend, which would
    // otherwise read this as a silence timeout and start listening again.
    shouldListenRef.current = false;
    if (restartTimerRef.current !== null) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      // stop() after end is a no-op on most browsers; ignore any late throws.
    }
  }, []);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else start();
  }, [isListening, start, stop]);

  return { isSupported, isListening, interimTranscript, start, stop, toggle };
}
