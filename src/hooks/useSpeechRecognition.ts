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

export interface UseSpeechRecognitionOptions {
  lang?: string;
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
 * Wraps the browser Web Speech API for one-shot dictation. Designed as a
 * building block for both the chat mic button (this PR) and a future
 * back-and-forth voice mode — start/stop are explicit so the caller can
 * later drive them from turn detection instead of a tap.
 */
export function useSpeechRecognition(opts: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionResult {
  const { lang = 'en-US', interimResults = true, onFinalResult, onInterimResult, onError } = opts;

  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
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
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setIsListening(true);
    rec.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };
    rec.onerror = (ev) => {
      // "aborted" and "no-speech" are normal outcomes when the user
      // taps the mic to cancel or stays silent — don't surface them.
      if (ev.error !== 'aborted' && ev.error !== 'no-speech') {
        onErrorRef.current?.(ev.error);
      }
      setIsListening(false);
      setInterimTranscript('');
    };
    rec.onresult = (ev) => {
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
  }, [lang, interimResults]);

  const start = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec || isListening) return;
    try {
      rec.start();
    } catch (e) {
      // Chrome throws InvalidStateError if start() is called while already
      // running — recover by aborting and retrying on the next tick.
      try { rec.abort(); } catch { /* noop */ }
      onErrorRef.current?.(e instanceof Error ? e.message : 'start-failed');
    }
  }, [isListening]);

  const stop = useCallback(() => {
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
