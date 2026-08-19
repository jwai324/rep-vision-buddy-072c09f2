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

// A fresh session started right after the browser cut the previous one off
// re-recognises the tail of the audio the old session already finalised. The
// echo is not reliably an exact repeat of the last phrase: the overlap can
// start mid-phrase ("three sets" then "three sets of squats"), span two of the
// old session's phrases, or arrive a couple of seconds late while the
// recogniser catches up. Everything a restarted session finalises inside this
// window is checked against what has already been emitted and trimmed to the
// part that is genuinely new.
const RESTART_OVERLAP_WINDOW_MS = 6000;

// Words kept from what has already been emitted, to match a restart's echo
// against. Long enough to cover a re-heard phrase or two, short enough that an
// unrelated word said much earlier can't swallow the start of a new phrase.
const OVERLAP_TAIL_WORDS = 24;

// How long everything can stay quiet before dictation decides the user is
// done and turns itself off. It has to outlast the browser's own end-of-speech
// detection several times over: that fires a second or two after you stop
// talking, which is nowhere near long enough to be "finished" — it's the
// length of a pause for breath. Measured from the last words heard, not from
// the last session restart, or a run of silent restarts would keep it alive
// forever.
const DEFAULT_STOP_AFTER_SILENCE_MS = 8000;

// Errors that mean another restart cannot possibly succeed.
const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);

// Compared on words rather than raw text: the same audio recognised twice
// comes back with different capitalisation and punctuation ("Add three sets"
// vs "add three sets,").
function toWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
}

/**
 * Drop the leading part of `phrase` that repeats the end of `tail`, and return
 * what's left. The whole phrase being an echo yields an empty string.
 *
 * Exported for unit testing — pure.
 */
export function trimEchoedPrefix(tail: readonly string[], phrase: string): string {
  const words = toWords(phrase);
  if (words.length === 0 || tail.length === 0) return phrase.trim();
  const normalized = words.map(normalizeWord);
  // Longest match first: the re-heard chunk is whatever the two sides share,
  // and taking the longest overlap is what turns "three sets of squats" into
  // "of squats" rather than leaving a stutter behind.
  for (let k = Math.min(words.length, tail.length); k > 0; k--) {
    const tailSlice = tail.slice(tail.length - k);
    if (tailSlice.every((word, i) => word === normalized[i])) {
      return words.slice(k).join(' ');
    }
  }
  return words.join(' ');
}

// Any transcript at all, interim or final, means the user is still talking.
function hasSpeech(ev: SpeechRecognitionEventLike): boolean {
  for (let i = 0; i < ev.results.length; i++) {
    if ((ev.results[i]?.[0]?.transcript ?? '').trim()) return true;
  }
  return false;
}

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
  // Silence, in ms, after which listening stops on its own — the caller is
  // treated as having finished talking. 0 disables it, leaving the session
  // live until the caller stops it.
  stopAfterSilenceMs?: number;
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
 * Wraps the browser Web Speech API for dictation that survives the pauses in
 * normal speech and then ends itself once the speaker is actually done —
 * browsers cut a session off after a second or two of quiet, which is a pause,
 * not an ending, so those gaps are bridged by restarting and only a long
 * silence (stopAfterSilenceMs) stops for real. Designed as a building block
 * for both the chat mic button and a future back-and-forth voice mode —
 * start/stop are explicit so the caller can later drive them from turn
 * detection instead of a tap.
 */
export function useSpeechRecognition(opts: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionResult {
  const {
    lang = 'en-US',
    continuous = true,
    interimResults = true,
    stopAfterSilenceMs = DEFAULT_STOP_AFTER_SILENCE_MS,
    onFinalResult,
    onInterimResult,
    onError,
  } = opts;

  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // The user's intent, as opposed to whether a session happens to be running.
  // A browser silence timeout ends the session without ending the intent, and
  // that gap is exactly what the auto-restart below covers.
  const shouldListenRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fires once the room has been quiet for stopAfterSilenceMs. Re-armed from
  // scratch every time words come in, so it measures silence since the last
  // thing said rather than since the session (re)started.
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set by the effect below so start() can arm the same timer the recognition
  // handlers use, without re-creating the recognition instance to reach it.
  const armSilenceTimerRef = useRef<() => void>(() => {});
  const stopAfterSilenceRef = useRef(stopAfterSilenceMs);
  useEffect(() => { stopAfterSilenceRef.current = stopAfterSilenceMs; }, [stopAfterSilenceMs]);
  const restartBurstRef = useRef({ count: 0, since: 0 });
  // How many results of the current session have already been handed to
  // onFinalResult. Results are finalised in order and never revised, so an
  // index is all it takes to tell a genuinely new phrase from a redelivery.
  const emittedFinalsRef = useRef(0);
  // Normalised words already handed to onFinalResult this listening run, most
  // recent last, for matching a restart's echo against. Reset per run, not per
  // session — the whole point is to look back across a restart.
  const emittedTailRef = useRef<string[]>([]);
  // When the current session started as a restart, and therefore may still be
  // re-reporting audio the previous one already finalised. 0 once a session has
  // produced something genuinely new.
  const restartedAtRef = useRef(0);
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

    const clearSilenceTimer = () => {
      if (silenceTimerRef.current !== null) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };

    const armSilenceTimer = () => {
      clearSilenceTimer();
      const window = stopAfterSilenceRef.current;
      if (!window || window <= 0) return;
      silenceTimerRef.current = setTimeout(() => {
        silenceTimerRef.current = null;
        if (!shouldListenRef.current) return;
        // Nothing said for long enough that this reads as finished rather than
        // mid-thought. Ending it the same way a tap would: no restart, mic off,
        // whatever was dictated left where it is for the caller to send.
        shouldListenRef.current = false;
        clearRestartTimer();
        setInterimTranscript('');
        setIsListening(false);
        try {
          rec.stop();
        } catch {
          // Already ended — onend has nothing left to do either.
        }
      }, window);
    };
    armSilenceTimerRef.current = armSilenceTimer;

    const giveUp = (reason?: string) => {
      shouldListenRef.current = false;
      clearRestartTimer();
      clearSilenceTimer();
      setIsListening(false);
      setInterimTranscript('');
      if (reason) onErrorRef.current?.(reason);
    };

    // `results` is per-session and starts empty again on every restart, so the
    // emitted-count has to reset with it or the new session's phrases would be
    // mistaken for ones already sent.
    rec.onstart = () => {
      emittedFinalsRef.current = 0;
      setIsListening(true);
    };

    rec.onend = () => {
      setInterimTranscript('');
      if (!shouldListenRef.current) {
        setIsListening(false);
        return;
      }

      // Anything the next session finalises straight away may be a re-run of
      // audio this one already reported.
      restartedAtRef.current = Date.now();

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
      const now = Date.now();
      restartBurstRef.current = { count: 0, since: now };
      // Interim results count: the point is to keep the session alive while
      // someone is mid-sentence, and interim text is the earliest sign of that.
      if (hasSpeech(ev)) armSilenceTimer();

      // `ev.results` is cumulative for the session, and ev.resultIndex is not
      // a reliable "everything before this is already handled" marker —
      // browsers routinely replay earlier entries, including finalised ones.
      // Walking the whole list and gating on emittedFinalsRef is what stops a
      // phrase from being appended to the input a second time.
      //
      // A cumulative list only ever grows. If it came back shorter, this
      // browser handed us a fresh list mid-session, and holding on to the old
      // count would silently swallow every phrase that follows.
      if (ev.results.length < emittedFinalsRef.current) emittedFinalsRef.current = 0;

      const interimParts: string[] = [];
      for (let i = 0; i < ev.results.length; i++) {
        const result = ev.results[i];
        const transcript = (result?.[0]?.transcript ?? '').trim();
        if (!result?.isFinal) {
          if (transcript) interimParts.push(transcript);
          continue;
        }
        if (i < emittedFinalsRef.current) continue;
        emittedFinalsRef.current = i + 1;
        if (!transcript) continue;

        // Only a session that began as a restart can be echoing, and only until
        // it reports something new — after that the user is talking again, and
        // a genuine repeat ("squats, squats") has to survive.
        const echoing =
          restartedAtRef.current !== 0 && now - restartedAtRef.current < RESTART_OVERLAP_WINDOW_MS;
        const fresh = echoing ? trimEchoedPrefix(emittedTailRef.current, transcript) : transcript;
        if (!fresh) continue;
        restartedAtRef.current = 0;

        emittedTailRef.current = [...emittedTailRef.current, ...toWords(fresh).map(normalizeWord)]
          .slice(-OVERLAP_TAIL_WORDS);
        onFinalResultRef.current?.(fresh);
      }
      // Joined rather than concatenated: the browser hands back separate
      // results without any trailing space, so raw concatenation runs the
      // words of the live preview together. A session still working through a
      // restart's echo gets the same trim as its finals, so the preview does
      // not replay words that are already sitting in the input box.
      const stillEchoing =
        restartedAtRef.current !== 0 && now - restartedAtRef.current < RESTART_OVERLAP_WINDOW_MS;
      const interimRaw = interimParts.join(' ');
      const interim = stillEchoing ? trimEchoedPrefix(emittedTailRef.current, interimRaw) : interimRaw;
      setInterimTranscript(interim);
      onInterimResultRef.current?.(interim);
    };

    recognitionRef.current = rec;
    return () => {
      // Drop the intent before detaching handlers, so a pending restart can't
      // outlive the component and leave the microphone open.
      shouldListenRef.current = false;
      clearRestartTimer();
      clearSilenceTimer();
      armSilenceTimerRef.current = () => {};
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
    emittedFinalsRef.current = 0;
    emittedTailRef.current = [];
    restartedAtRef.current = 0;
    // Armed from the tap, so a mic opened and never spoken into closes itself
    // instead of sitting live.
    armSilenceTimerRef.current();
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
    if (silenceTimerRef.current !== null) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
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
