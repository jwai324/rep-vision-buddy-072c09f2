/**
 * Speech-to-text for the AI coach chat, over the browser's SpeechRecognition.
 *
 * The one job here is to never write a word twice and never lose one the user
 * watched appear. Three decisions do that work:
 *
 * **One utterance per browser session.** The recognizer runs with
 * `continuous` off, the mode every browser implements the same way: the
 * session hears one utterance, finalizes it, and ends. Continuous mode is where
 * phone browsers go wrong — Chrome for Android segments a long session
 * internally and its own result list can carry the same audio twice, at
 * different indices ("add three sets" / "three sets of squats"), which no
 * bookkeeping on this side can tell from a real repetition. A single-utterance
 * session has no internal boundaries for that to happen at.
 *
 * **A session's text is a pure function of its latest result list.** Nothing is
 * appended per event. Each `onresult` carries the browser's whole list for the
 * session, so the newest list is the whole truth and the session's text is
 * simply recomputed from it (`transcriptOf`). A redelivery changes nothing and a
 * revision replaces. The list is joined with two structural rules and no
 * word-level guessing: an entry equal to the one before it is the browser
 * listing a phrase twice, and an entry that begins with the whole of the one
 * before it is the browser rewriting that phrase cumulatively.
 *
 * **Sessions are chained by the app, and never overlap.** When the browser ends
 * a session that heard speech, the next one opens so the user can keep
 * talking; a session that heard nothing ends the run, which is how silence
 * releases the microphone. Every handler is bound to its own session object
 * and ignored once that session is no longer current, so a session on its way
 * out cannot report into the one replacing it. Each ended session contributes
 * its text once, in order, and the run's words are handed over exactly once,
 * through `onEnd`, when the run finishes.
 *
 * Framework-free — React binds to it through `useSpeechToText`.
 */

// The vendor-prefixed globals aren't in TypeScript's DOM lib; declare only the
// surface used here.
export interface SpeechAlternative {
  readonly transcript: string;
  readonly confidence?: number;
}
export interface SpeechResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechAlternative;
}
export interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
export interface SpeechResultEvent {
  readonly results: SpeechResultList;
}
export interface SpeechErrorEvent {
  readonly error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((ev: Event) => unknown) | null;
  onend: ((ev: Event) => unknown) | null;
  onerror: ((ev: SpeechErrorEvent) => unknown) | null;
  onresult: ((ev: SpeechResultEvent) => unknown) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function findSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const globals = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return globals.SpeechRecognition ?? globals.webkitSpeechRecognition ?? null;
}

export interface SpeechToTextState {
  /** The microphone is open. */
  listening: boolean;
  /**
   * Every word of the current run so far, the phrase in flight included. Empty
   * once the run's words have been handed over through `onEnd`.
   */
  transcript: string;
}

export interface SpeechToTextError {
  reason:
    | 'unsupported' // this browser has no recognizer
    | 'denied' // the user or the browser refused microphone access
    | 'no-microphone' // nothing to record from
    | 'no-start' // the session died on the spot without ever listening
    | 'recognizer-error'; // anything else the browser reported
  /** The raw SpeechRecognitionErrorEvent.error, when the browser gave one. */
  code?: string;
}

export interface SpeechToTextOptions {
  lang?: string;
  /** The run's words, delivered exactly once, when the run finishes. */
  onEnd?: (words: string) => void;
  onError?: (error: SpeechToTextError) => void;
  /** Injectable clock, so tests don't have to wait out real durations. */
  now?: () => number;
}

/**
 * No result for this long ends the run: the browser's own no-speech timeout
 * usually gets there first, but not every browser has one.
 */
export const SILENCE_TIMEOUT_MS = 10_000;
/**
 * After the mic button ends a run, the browser gets this long to finalize the
 * phrase in flight before its interim text is taken as it stands.
 */
export const FINALIZE_GRACE_MS = 1_000;
/**
 * The next session opens this long after the browser ends the last one. On
 * Android the native recognizer behind a session is torn down asynchronously,
 * and a start that races that teardown is refused as "busy".
 */
export const RESTART_DELAY_MS = 100;
/**
 * A session that ends this soon without a result never listened at all — a
 * recognizer the browser refused to run, not a silence timeout, which takes
 * seconds. For the first session of a run that is worth reporting: otherwise
 * the only sign is the mic button flicking straight back off. For a chained
 * session it ends the run quietly, with the words heard so far.
 */
const VIABLE_SESSION_MS = 300;

const FATAL_ERRORS: Record<string, SpeechToTextError['reason']> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'no-microphone',
};

const IDLE: SpeechToTextState = { listening: false, transcript: '' };

function tidy(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The text of one session, from the result list the browser holds for it.
 *
 * Entries are joined in the browser's order. Two structural rules cover the
 * ways browsers list one phrase twice; neither compares individual words:
 * - an entry identical to the one before it is dropped (Chrome for Android
 *   lists a final result a second time, at a new index);
 * - an entry that begins with the whole of the one before it replaces it (a
 *   recognizer that reports cumulatively rewrites the phrase rather than
 *   adding to it).
 */
export function transcriptOf(results: SpeechResultList): string {
  const kept: string[] = [];
  for (let index = 0; index < results.length; index++) {
    const text = tidy(results[index]?.[0]?.transcript);
    if (!text) continue;
    const previous = kept[kept.length - 1];
    if (previous !== undefined) {
      const a = text.toLowerCase();
      const b = previous.toLowerCase();
      if (a === b) continue;
      if (a.startsWith(`${b} `)) kept.pop();
    }
    kept.push(text);
  }
  return kept.join(' ');
}

function joinSegments(segments: readonly string[]): string {
  return segments.filter(Boolean).join(' ');
}

interface Session {
  readonly recognizer: SpeechRecognitionLike;
  readonly openedAt: number;
  /** Rebuilt from the latest result list on every report. */
  text: string;
  /** Whether any words have arrived at all. */
  heard: boolean;
}

export class SpeechToText {
  private readonly lang: string;
  private readonly onEnd?: (words: string) => void;
  private readonly onError?: (error: SpeechToTextError) => void;
  private readonly now: () => number;

  private readonly listeners = new Set<(state: SpeechToTextState) => void>();
  private state: SpeechToTextState = IDLE;

  private session: Session | null = null;
  /** Text of the sessions that have ended during this run, in order. */
  private segments: string[] = [];
  /** A run is on from `start()` until its words are handed over. */
  private running = false;
  /** `stop()` has been pressed and the run is waiting to hand its words over. */
  private closing = false;
  /** When the last recognizer was told to abort; see `start`. */
  private lastAbortAt = -Infinity;

  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: SpeechToTextOptions = {}) {
    this.lang = options.lang ?? 'en-US';
    this.onEnd = options.onEnd;
    this.onError = options.onError;
    this.now = options.now ?? (() => Date.now());
  }

  /** Whether this browser exposes a recognizer at all. */
  get supported(): boolean {
    return findSpeechRecognition() !== null;
  }

  // Bound so React can hand them straight to useSyncExternalStore.
  getState = (): SpeechToTextState => this.state;

  subscribe = (listener: (state: SpeechToTextState) => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Open the microphone. A run already closing hands its words over first. */
  start = (): void => {
    if (this.running && !this.closing) return;
    if (this.running) this.finish({});

    const Recognizer = findSpeechRecognition();
    if (!Recognizer) {
      this.onError?.({ reason: 'unsupported' });
      return;
    }

    this.running = true;
    this.segments = [];
    this.publish({ listening: true, transcript: '' });

    // A recognizer told to abort a moment ago — a double tap on the mic, or a
    // tap straight after a send — may still be tearing down, and a start that
    // races that is refused. Give it the same room a chained session gets.
    const sinceAbort = this.now() - this.lastAbortAt;
    if (sinceAbort < RESTART_DELAY_MS) this.openSessionLater(RESTART_DELAY_MS - sinceAbort);
    else this.openSession(Recognizer);
  };

  /**
   * Switch the microphone off. The phrase in flight gets a moment to
   * finalize; then the run's words go to `onEnd`.
   */
  stop = (): void => {
    if (!this.running || this.closing) return;

    this.closing = true;
    this.clearTimer('silence');
    this.clearTimer('restart');
    this.publish({ listening: false });

    const session = this.session;
    // Between sessions there is nothing in flight to wait for. The words are
    // still handed over from a fresh task: `stop()` is also what the chat calls
    // from an effect when its panel closes, and a hand-over from inside a React
    // effect could not be committed atomically (see useSpeechToText).
    const grace = session ? FINALIZE_GRACE_MS : 0;
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.finish({});
    }, grace);
    if (!session) return;
    try {
      session.recognizer.stop();
    } catch {
      this.finish({});
    }
  };

  /** Switch the microphone off and forget the run's words. */
  cancel = (): void => {
    if (!this.running) return;
    this.finish({ discard: true });
  };

  toggle = (): void => {
    if (this.state.listening) this.stop();
    else this.start();
  };

  /** Release the microphone and drop every listener; the words are lost. */
  dispose = (): void => {
    this.cancel();
    this.listeners.clear();
  };

  private openSession(Recognizer: SpeechRecognitionConstructor): void {
    const recognizer = new Recognizer();
    recognizer.lang = this.lang;
    recognizer.continuous = false;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    const session: Session = {
      recognizer,
      openedAt: this.now(),
      text: '',
      heard: false,
    };
    // Gated on the session still being current, so a departing session's late
    // events can't touch the run that moved on.
    recognizer.onresult = event => {
      if (this.session !== session) return;
      const text = transcriptOf(event.results);
      // Only a report that changes the words counts as the user speaking: a
      // blank result, or a replay of what is already there, must neither keep
      // the run alive nor count as having heard anything.
      const spoke = text !== session.text;
      session.text = text;
      if (text) session.heard = true;
      if (spoke && !this.closing) this.armSilenceTimer();
      this.publish({ transcript: joinSegments([...this.segments, session.text]) });
    };
    recognizer.onerror = event => {
      if (this.session !== session) return;
      this.handleSessionError(session, event.error);
    };
    recognizer.onend = () => {
      if (this.session !== session) return;
      this.handleSessionEnd(session);
    };

    this.session = session;
    this.armSilenceTimer();
    try {
      recognizer.start();
    } catch {
      // Chrome throws InvalidStateError if a recognizer is started twice. The
      // session is unusable either way, so treat it as one that died at once.
      this.handleSessionEnd(session);
    }
  }

  private handleSessionError(session: Session, code: string): void {
    const fatal = FATAL_ERRORS[code];
    if (fatal) {
      // Chrome for Android reports a recognizer still busy tearing down the
      // last session as 'not-allowed'. That refusal arrives at once, on a
      // chained session, after permission was plainly granted for the first —
      // so it ends the run quietly rather than as a denial.
      const refusedAtOnce = !session.heard && this.now() - session.openedAt < VIABLE_SESSION_MS;
      const chained = this.segments.length > 0;
      this.finish(refusedAtOnce && chained ? {} : { error: { reason: fatal, code } });
      return;
    }
    // 'aborted' is what closing a recognizer produces and 'no-speech' means
    // the browser gave up waiting; onend follows either and settles the run.
    if (code === 'aborted' || code === 'no-speech') return;
    this.finish({ error: { reason: 'recognizer-error', code } });
  }

  /** The browser closed the session on its own. */
  private handleSessionEnd(session: Session): void {
    if (this.closing) {
      this.finish({ ended: true });
      return;
    }
    if (!session.heard) {
      const stillborn = this.now() - session.openedAt < VIABLE_SESSION_MS;
      const firstSession = this.segments.length === 0;
      this.finish({
        ended: true,
        error: stillborn && firstSession ? { reason: 'no-start' } : undefined,
      });
      return;
    }

    this.segments.push(session.text);
    this.session = null;
    this.clearTimer('silence');
    this.openSessionLater(RESTART_DELAY_MS);
  }

  private openSessionLater(delay: number): void {
    this.clearTimer('restart');
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      const Recognizer = findSpeechRecognition();
      if (Recognizer) this.openSession(Recognizer);
      else this.finish({});
    }, delay);
  }

  /**
   * End the run. The current session's text — final or interim — joins the
   * segments unless the words are being discarded; then everything is handed
   * over, exactly once. `ended` says the browser has already closed the
   * session, so there is nothing left to abort or to wait for.
   */
  private finish({
    discard = false,
    ended = false,
    error,
  }: {
    discard?: boolean;
    ended?: boolean;
    error?: SpeechToTextError;
  }): void {
    this.clearTimer('silence');
    this.clearTimer('grace');
    this.clearTimer('restart');

    const session = this.session;
    this.session = null;
    if (session) {
      const { recognizer } = session;
      recognizer.onstart = null;
      recognizer.onend = null;
      recognizer.onerror = null;
      recognizer.onresult = null;
      if (!ended) {
        try {
          recognizer.abort();
        } catch {
          // Some browsers throw when aborting a recognizer that never started.
        }
        this.lastAbortAt = this.now();
      }
      if (!discard) this.segments.push(session.text);
    }

    const words = discard ? '' : joinSegments(this.segments);
    this.segments = [];
    this.running = false;
    this.closing = false;
    // The transcript is cleared before the words are handed over, so a
    // consumer that shows both never has them on screen twice; the hook makes
    // the two land in one React commit.
    this.publish({ listening: false, transcript: '' });

    if (words) this.onEnd?.(words);
    if (error) this.onError?.(error);
  }

  private armSilenceTimer(): void {
    this.clearTimer('silence');
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      this.finish({});
    }, SILENCE_TIMEOUT_MS);
  }

  private clearTimer(which: 'silence' | 'grace' | 'restart'): void {
    const key = `${which}Timer` as const;
    const timer = this[key];
    if (timer !== null) {
      clearTimeout(timer);
      this[key] = null;
    }
  }

  private publish(patch: Partial<SpeechToTextState>): void {
    const next = { ...this.state, ...patch };
    if (next.listening === this.state.listening && next.transcript === this.state.transcript) return;
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
