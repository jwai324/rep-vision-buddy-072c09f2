/**
 * Speech-to-text for the AI coach chat, over the browser's SpeechRecognition.
 *
 * Two rules hold this together, and they are why the file is short.
 *
 * **The transcript is derived, never accumulated.** Every time the recognizer
 * reports anything, the run's text is recomputed from the results the browser
 * is holding — each filed under the index the browser gave it — instead of
 * being appended to. Nothing can therefore land twice: a browser that
 * redelivers a phrase (Chrome replays a session's whole result list on every
 * event) writes over the slot it already filled, and one that revises a phrase
 * replaces it. Nothing here tries to guess whether words are a repeat, either:
 * an earlier version screened re-heard audio by comparing incoming words
 * against the transcript, and that guesswork cut real words out of messages as
 * often as it removed duplicates. Every word the recognizer reports is kept,
 * exactly once, in the order it was reported.
 *
 * **A run is one session.** Browsers end a session on their own silence
 * timeout, and when that happens the run ends with it: the words are handed
 * over exactly as if the mic button had been pressed, and the microphone is
 * released. Reopening a session behind the user's back is what an earlier
 * version did, and it made the mic impossible to predict — it stayed live long
 * after anyone was talking, and every reopen was another chance for a session
 * to report over the top of the one it replaced. Dictating another sentence is
 * one tap, and it carries on after the words already in the box.
 *
 * Deliberately framework-free — React talks to it through `useDictation`.
 */

// The vendor-prefixed globals aren't in TypeScript's DOM lib, so declare just
// the surface used here.
interface RecognitionAlternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionResultEvent {
  readonly results: RecognitionResultList;
}
interface RecognitionErrorEvent {
  readonly error: string;
}

export interface SpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((ev: Event) => unknown) | null;
  onend: ((ev: Event) => unknown) | null;
  onerror: ((ev: RecognitionErrorEvent) => unknown) | null;
  onresult: ((ev: RecognitionResultEvent) => unknown) | null;
}

type RecognizerConstructor = new () => SpeechRecognizer;

function findRecognizerConstructor(): RecognizerConstructor | null {
  if (typeof window === 'undefined') return null;
  const globals = window as unknown as {
    SpeechRecognition?: RecognizerConstructor;
    webkitSpeechRecognition?: RecognizerConstructor;
  };
  return globals.SpeechRecognition ?? globals.webkitSpeechRecognition ?? null;
}

export interface DictationState {
  listening: boolean;
  /** Everything the run has finalized so far. */
  transcript: string;
  /** The phrase being spoken right now. Empty between phrases. */
  partial: string;
}

export interface DictationFailure {
  reason:
    | 'denied' // the user or the browser refused microphone access
    | 'no-microphone' // nothing to record from
    | 'no-start' // the session died on the spot without ever listening
    | 'recognizer-error'; // anything else the browser reported
  /** The raw SpeechRecognitionErrorEvent.error, when the browser gave one. */
  code?: string;
}

export interface DictationOptions {
  lang?: string;
  onFailure?: (failure: DictationFailure) => void;
  /** Injectable clock, so tests don't have to wait out real durations. */
  now?: () => number;
}

const IDLE_STATE: DictationState = { listening: false, transcript: '', partial: '' };

// A session that ends this soon without having heard anything never listened at
// all — a recognizer the browser refused to run, rather than a silence timeout,
// which takes seconds to arrive. Worth saying so, because the only thing the
// user would otherwise see is the mic button flicking straight back off.
const VIABLE_SESSION_MS = 250;

// No restart can fix these, so they end the run with something to show for it.
const FATAL_ERRORS: Record<string, DictationFailure['reason']> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'no-microphone',
};

/** Joins spoken fragments into one line, ignoring the blanks. */
function joinWords(parts: Iterable<string>): string {
  const words: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) words.push(trimmed);
  }
  return words.join(' ');
}

/** Text of a set of results, in the order the browser numbered them. */
function inOrder(results: Map<number, string>): string {
  const sorted = [...results.entries()].sort((a, b) => a[0] - b[0]);
  return joinWords(sorted.map(([, text]) => text));
}

export class Dictation {
  private readonly lang: string;
  private readonly onFailure?: (failure: DictationFailure) => void;
  private readonly now: () => number;

  private readonly listeners = new Set<(state: DictationState) => void>();
  private state: DictationState = IDLE_STATE;

  private recognizer: SpeechRecognizer | null = null;

  // Finalized phrases under the index the browser filed them at. Assigning by
  // index is what makes a redelivery a no-op and a revision an overwrite.
  private readonly finals = new Map<number, string>();
  // The phrase in flight, under its index. Rebuilt from scratch on every report
  // — interim text is a preview, not a record — and folded into `finals` if the
  // run ends before the browser gets round to finalizing it, so the words on
  // screen are the words handed over.
  private pending = new Map<number, string>();
  // Results this session has reported, and the first index of those the caller
  // hasn't banked. `banked` only ever moves forward.
  private reported = 0;
  private banked = 0;

  private sessionOpenedAt = 0;
  private heardSomething = false;

  constructor(options: DictationOptions = {}) {
    this.lang = options.lang ?? 'en-US';
    this.onFailure = options.onFailure;
    this.now = options.now ?? Date.now;
  }

  /** Whether this browser exposes a recognizer at all. */
  get supported(): boolean {
    return findRecognizerConstructor() !== null;
  }

  // Bound so React can hand them straight to useSyncExternalStore, which
  // resubscribes whenever the reference changes.
  getState = (): DictationState => this.state;

  subscribe = (listener: (state: DictationState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Begin a run. Its transcript starts empty: whatever the last run heard
   * belongs to that run, and the caller has already banked it.
   */
  start = (): void => {
    if (this.state.listening) return;
    const Recognizer = findRecognizerConstructor();
    if (!Recognizer) {
      this.onFailure?.({ reason: 'recognizer-error', code: 'unsupported' });
      return;
    }

    this.finals.clear();
    this.pending.clear();
    this.reported = 0;
    this.banked = 0;

    const recognizer = new Recognizer();
    recognizer.lang = this.lang;
    // `continuous` asks the browser to hear more than a single utterance. Not
    // every browser honours it, which is the whole reason the run ends when the
    // session does rather than pretending otherwise.
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    // Every handler is gated on this still being the live recognizer, so one on
    // its way out can't report into the run that replaced it — two recognizers
    // reporting the same audio is the one way this design could double a word.
    const mine = () => this.recognizer === recognizer;
    recognizer.onstart = () => {
      if (mine()) this.publish({ listening: true });
    };
    recognizer.onresult = event => {
      if (mine()) this.handleResult(event);
    };
    recognizer.onerror = event => {
      if (mine()) this.handleError(event);
    };
    recognizer.onend = () => {
      if (mine()) this.handleEnd();
    };

    this.recognizer = recognizer;
    this.sessionOpenedAt = this.now();
    this.heardSomething = false;
    this.publish({ listening: true, ...this.spoken() });

    try {
      recognizer.start();
    } catch {
      // Chrome throws InvalidStateError if a recognizer is started twice. The
      // session is unusable either way, so treat it as one that died at once.
      this.handleEnd();
    }
  };

  /** End the run, keeping the transcript for the caller to bank. */
  stop = (): void => {
    if (!this.recognizer && !this.state.listening) return;
    this.closeRecognizer();
    this.keepWhatWasSaid();
    this.publish({ listening: false, ...this.spoken() });
  };

  toggle = (): void => {
    if (this.state.listening) this.stop();
    else this.start();
  };

  /**
   * Forget everything said so far without ending the run. The chat calls this
   * once it has folded the transcript into the message box, so the same words
   * aren't handed over twice. The phrase in flight counts as banked too — its
   * interim text is already on screen.
   */
  reset = (): void => {
    this.banked = this.reported;
    for (const index of this.finals.keys()) {
      if (index < this.banked) this.finals.delete(index);
    }
    this.pending.clear();
    this.publish(this.spoken());
  };

  /** Release the microphone and drop every listener. */
  dispose = (): void => {
    this.closeRecognizer();
    this.listeners.clear();
    this.state = { ...this.state, listening: false, partial: '' };
  };

  /** The run's text, rebuilt from what the browser has reported. */
  private spoken(): { transcript: string; partial: string } {
    return { transcript: inOrder(this.finals), partial: inOrder(this.pending) };
  }

  /**
   * Take the phrase in flight at its word. The run is ending, so nothing is
   * going to finalize it, and dropping it would lose words the user watched
   * appear in the box.
   */
  private keepWhatWasSaid(): void {
    for (const [index, text] of this.pending) this.finals.set(index, text);
    this.pending.clear();
  }

  private publish(patch: Partial<DictationState>): void {
    const next = { ...this.state, ...patch };
    if (
      next.listening === this.state.listening &&
      next.transcript === this.state.transcript &&
      next.partial === this.state.partial
    ) {
      return;
    }
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }

  private closeRecognizer(): void {
    const recognizer = this.recognizer;
    if (!recognizer) return;
    this.recognizer = null;
    recognizer.onstart = null;
    recognizer.onend = null;
    recognizer.onerror = null;
    recognizer.onresult = null;
    try {
      recognizer.abort();
    } catch {
      // Some browsers throw when aborting a recognizer that never started.
    }
  }

  private fail(failure: DictationFailure): void {
    this.closeRecognizer();
    this.keepWhatWasSaid();
    this.publish({ listening: false, ...this.spoken() });
    this.onFailure?.(failure);
  }

  private handleResult(event: RecognitionResultEvent): void {
    this.heardSomething = true;

    const results = event.results;
    this.reported = Math.max(this.reported, results.length);

    const speaking = new Map<number, string>();
    for (let index = 0; index < results.length; index++) {
      // Anything the caller has banked stays gone, however often the browser
      // replays it — including the phrase that was still in flight, whose
      // interim text was banked with the rest.
      if (index < this.banked) continue;
      const result = results[index];
      const text = (result?.[0]?.transcript ?? '').trim();
      if (!text) continue;
      if (result.isFinal) this.finals.set(index, text);
      else speaking.set(index, text);
    }
    this.pending = speaking;
    this.publish(this.spoken());
  }

  private handleError(event: RecognitionErrorEvent): void {
    const fatal = FATAL_ERRORS[event.error];
    if (fatal) {
      this.fail({ reason: fatal, code: event.error });
      return;
    }
    // 'aborted' is what closing the recognizer produces, and 'no-speech' just
    // means the browser gave up waiting. Neither is worth reporting: onend
    // follows either way and ends the run with whatever was said.
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    this.fail({ reason: 'recognizer-error', code: event.error });
  }

  private handleEnd(): void {
    const stillborn = !this.heardSomething && this.now() - this.sessionOpenedAt < VIABLE_SESSION_MS;
    if (stillborn) {
      this.fail({ reason: 'no-start' });
      return;
    }
    this.closeRecognizer();
    this.keepWhatWasSaid();
    this.publish({ listening: false, ...this.spoken() });
  }
}
