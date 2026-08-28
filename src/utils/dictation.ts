/**
 * Speech-to-text for the AI coach chat, over the browser's SpeechRecognition.
 *
 * One rule holds this together, and it is why the file is short: **the
 * transcript is derived, never accumulated.** Every time the recognizer reports
 * anything, the run's text is recomputed from what the browser is holding —
 * results filed under the index the browser gave them — instead of being
 * appended to. Nothing can therefore be added twice: a browser that redelivers
 * a phrase (Chrome replays a session's whole result list on every event) writes
 * over the slot it already filled, and a browser that revises one replaces it.
 *
 * The corollary is that nothing here tries to guess whether words are a repeat.
 * An earlier version screened re-heard audio by comparing the incoming words
 * against the transcript, and that guesswork cut real words out of the message
 * as often as it removed duplicates. Every word the recognizer reports is kept,
 * exactly once, in the order it was reported.
 *
 * A run outlives the browser's sessions: browsers end a session on their own
 * silence timeout even in continuous mode, so a run reopens one until the user
 * stops — or until the microphone has gone quiet long enough that plainly
 * nobody is talking into it. Sessions never overlap and never interact: a
 * session's words are committed to the run once, when it ends.
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
    | 'unstable' // sessions kept dying the instant they opened
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

// A run nobody has said anything into for this long is over. Without it, "keep
// listening until I say stop" means a microphone that stays live indefinitely —
// including behind a reply that has taken the send button away. Comfortably
// longer than a pause for thought, and longer than the browser's own per-session
// silence timeout, so an ordinary hesitation just reopens a session.
const QUIET_RUN_LIMIT_MS = 10_000;

// A session that opens and dies immediately, again and again, without ever
// hearing anything is a recognizer the browser won't run rather than silence: a
// real silence timeout takes seconds to arrive.
const VIABLE_SESSION_MS = 250;
const MAX_DEAD_SESSIONS = 4;

// No restart can fix these, so the run ends instead of reopening into them.
const FATAL_ERRORS: Record<string, DictationFailure['reason']> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'no-microphone',
};

/** Joins spoken fragments into one line, ignoring the blanks. */
function joinWords(parts: readonly string[]): string {
  return parts
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ');
}

export class Dictation {
  private readonly lang: string;
  private readonly onFailure?: (failure: DictationFailure) => void;
  private readonly now: () => number;

  private readonly listeners = new Set<(state: DictationState) => void>();
  private state: DictationState = IDLE_STATE;

  // What the user asked for, as opposed to whether a session is open right now.
  private wantsToListen = false;

  private recognizer: SpeechRecognizer | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  // Text of the sessions this run has already finished with.
  private committed = '';
  // The open session's finalized phrases, under the index the browser filed
  // them at. Assigning by index is what makes a redelivery a no-op.
  private readonly finals = new Map<number, string>();
  // Results the open session has reported, and the first index of those the
  // caller hasn't banked. `banked` only ever moves forward.
  private reported = 0;
  private banked = 0;
  private partial = '';

  private lastHeardAt = 0;
  private sessionOpenedAt = 0;
  private sessionHeardSomething = false;
  private deadSessions = 0;

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
   * Begin a run. Its transcript starts empty: whatever a previous run heard
   * belongs to that run, and the caller has already banked it.
   */
  start = (): void => {
    if (this.wantsToListen) return;
    if (!findRecognizerConstructor()) {
      this.onFailure?.({ reason: 'recognizer-error', code: 'unsupported' });
      return;
    }
    this.wantsToListen = true;
    this.deadSessions = 0;
    this.lastHeardAt = this.now();
    this.clearRun();
    this.openSession();
    this.publish({ listening: true, ...this.spoken() });
  };

  /** End the run, keeping the transcript for the caller to bank. */
  stop = (): void => {
    // Intent goes first: closing the recognizer can fire onend, which would
    // otherwise read as the browser's silence timeout and reopen the session.
    this.wantsToListen = false;
    this.cancelRestart();
    this.closeRecognizer();
    this.commitSession();
    this.publish({ listening: false, ...this.spoken() });
  };

  toggle = (): void => {
    if (this.wantsToListen) this.stop();
    else this.start();
  };

  /**
   * Forget everything said so far without ending the run. The chat calls this
   * once it has folded the transcript into the message box, so the same words
   * aren't handed over twice. The phrase in flight counts as banked too — its
   * interim text is already on screen.
   */
  reset = (): void => {
    this.committed = '';
    this.banked = this.reported;
    for (const index of this.finals.keys()) {
      if (index < this.banked) this.finals.delete(index);
    }
    this.partial = '';
    this.publish(this.spoken());
  };

  /** Release the microphone and drop every listener. */
  dispose = (): void => {
    this.wantsToListen = false;
    this.cancelRestart();
    this.closeRecognizer();
    this.listeners.clear();
  };

  /** The run's text, rebuilt from what the browser has reported. */
  private spoken(): { transcript: string; partial: string } {
    return { transcript: joinWords([this.committed, this.sessionText()]), partial: this.partial };
  }

  private sessionText(): string {
    const spoken = [...this.finals.entries()]
      // Indexes generally arrive in order; sorting is cheap insurance against a
      // browser that fills a gap late.
      .sort((a, b) => a[0] - b[0])
      .map(([, text]) => text);
    return joinWords(spoken);
  }

  private clearRun(): void {
    this.committed = '';
    this.finals.clear();
    this.reported = 0;
    this.banked = 0;
    this.partial = '';
  }

  /** Fold the open session's words into the run and start a fresh one. */
  private commitSession(): void {
    this.committed = joinWords([this.committed, this.sessionText()]);
    this.finals.clear();
    this.reported = 0;
    this.banked = 0;
    this.partial = '';
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

  private cancelRestart(): void {
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
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
    this.wantsToListen = false;
    this.cancelRestart();
    this.closeRecognizer();
    this.commitSession();
    this.publish({ listening: false, ...this.spoken() });
    this.onFailure?.(failure);
  }

  /**
   * Open a session. Each gets its own recognizer object, and every handler is
   * gated on it still being the current one, so a session that is on its way
   * out can't report into the one that replaced it — two recognizers reporting
   * the same audio is the one way this design could double a word.
   */
  private openSession(): void {
    const Recognizer = findRecognizerConstructor();
    if (!Recognizer) return;

    this.closeRecognizer();
    const recognizer = new Recognizer();
    recognizer.lang = this.lang;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

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
    this.sessionHeardSomething = false;
    try {
      recognizer.start();
    } catch {
      // Chrome throws InvalidStateError if a recognizer is started twice. The
      // session is unusable either way, so treat it as one that died.
      this.handleEnd();
    }
  }

  private handleResult(event: RecognitionResultEvent): void {
    this.sessionHeardSomething = true;
    this.deadSessions = 0;
    this.lastHeardAt = this.now();

    const results = event.results;
    this.reported = Math.max(this.reported, results.length);

    const speaking: string[] = [];
    for (let index = 0; index < results.length; index++) {
      // Anything the caller has banked stays gone, however often the browser
      // replays it — including the phrase that was still in flight, whose
      // interim text was banked with the rest.
      if (index < this.banked) continue;
      const result = results[index];
      const text = (result?.[0]?.transcript ?? '').trim();
      if (!text) continue;
      if (result.isFinal) this.finals.set(index, text);
      else speaking.push(text);
    }
    this.partial = joinWords(speaking);
    this.publish(this.spoken());
  }

  private handleError(event: RecognitionErrorEvent): void {
    const fatal = FATAL_ERRORS[event.error];
    if (fatal) {
      this.fail({ reason: fatal, code: event.error });
      return;
    }
    // 'aborted' is what closing the recognizer produces, and 'no-speech' is
    // just a pause. Both leave the run alone and let onend decide what to do.
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    this.fail({ reason: 'recognizer-error', code: event.error });
  }

  private handleEnd(): void {
    this.closeRecognizer();
    this.commitSession();

    if (!this.wantsToListen) {
      this.publish({ listening: false, ...this.spoken() });
      return;
    }

    // Nobody is talking into this any more. Ending the run releases the
    // microphone and hands the words over exactly as the mic button would.
    if (this.now() - this.lastHeardAt >= QUIET_RUN_LIMIT_MS) {
      this.stop();
      return;
    }

    const viable = this.sessionHeardSomething || this.now() - this.sessionOpenedAt >= VIABLE_SESSION_MS;
    this.deadSessions = viable ? 0 : this.deadSessions + 1;
    if (this.deadSessions > MAX_DEAD_SESSIONS) {
      this.fail({ reason: 'unstable' });
      return;
    }

    // `listening` deliberately stays true across the gap, so the mic button
    // doesn't blink every time the browser times a session out.
    this.publish(this.spoken());
    this.cancelRestart();
    // Deferred: Chrome rejects a start() issued from inside its own onend.
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.wantsToListen) this.openSession();
    }, 0);
  }
}
