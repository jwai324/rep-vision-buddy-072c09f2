/**
 * Speech-to-text for the AI coach chat, built on the browser's SpeechRecognition.
 *
 * The engine owns the whole transcript of a dictation run rather than emitting
 * chunks as they arrive. Every finalized phrase is filed in a ledger under the
 * session it came from and its index within that session, and the transcript is
 * those entries joined. Filing is therefore idempotent: browsers routinely
 * redeliver — and sometimes revise — results the caller has already seen, and a
 * redelivery lands on the key it already occupies instead of appending a second
 * copy. That property is why this is a store rather than an event emitter; an
 * append-per-callback design has to keep a high-water mark in sync with the
 * browser's bookkeeping, and gets a duplicated phrase wrong whenever it drifts.
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
  /** Every phrase finalized so far this run, joined. */
  transcript: string;
  /** The phrase currently being spoken. Empty between phrases. */
  partial: string;
}

export interface DictationFailure {
  reason:
    | 'denied' // the user or the browser refused microphone access
    | 'no-microphone' // nothing to record from
    | 'unstable' // sessions kept dying without ever hearing anything
    | 'recognizer-error'; // anything else the browser reported
  /** The raw SpeechRecognitionErrorEvent.error, when the browser gave one. */
  code?: string;
}

export interface DictationEngineOptions {
  lang?: string;
  onFailure?: (failure: DictationFailure) => void;
  /** Injectable clock, so tests don't have to wait out real durations. */
  now?: () => number;
}

const IDLE_STATE: DictationState = { listening: false, transcript: '', partial: '' };

// A session that reopens and dies again without hearing anything is either a
// dead microphone or a recognizer the browser won't run. Silence looks the same
// from the outside, so the two are told apart by how long the session lasted:
// a real silence timeout runs for seconds, a refusal returns immediately.
const VIABLE_SESSION_MS = 250;
const MAX_STILLBORN_SESSIONS = 4;

// Reopening mid-sentence makes the recognizer re-hear audio the closing session
// already reported, so the first phrases of a reopened session are screened
// against the transcript. Two is enough to cover the echo — Chrome replays at
// most the trailing phrase or two — and it keeps a genuine repetition ("squats,
// squats") from being swallowed later in the session.
const SCREENED_PHRASES_AFTER_REOPEN = 2;

// Words of already-banked text kept for that screening. Long enough to cover a
// re-heard phrase or two, short enough that a word said much earlier can't
// swallow the start of a new one.
const ECHO_CONTEXT_WORDS = 30;

// A run that has gone this long without the recognizer reporting anything is
// over: the user has said their piece and walked away from the mic. Reopening
// past this point leaves the microphone live indefinitely — and every reopen is
// another chance to re-hear audio. Comfortably longer than a pause for thought,
// and longer than the browser's own per-session silence timeout.
const QUIET_RUN_LIMIT_MS = 12_000;

// No restart can fix these, so the run ends instead of reopening into them.
const FATAL_ERRORS: Record<string, DictationFailure['reason']> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'no-microphone',
};

/** Words stripped of the case and punctuation two passes over the same audio disagree on. */
function comparableWords(text: string): string[] {
  return text
    .split(/\s+/)
    .map(word => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean);
}

/**
 * How many leading words of `incoming` repeat the end of `established`.
 *
 * The longest such run wins: a reopened session that re-hears "three sets" and
 * carries on into "three sets of squats" has to lose both words, not just the
 * one, or the transcript stutters. Exported for testing.
 */
export function echoedWordCount(established: string, incoming: string): number {
  const tail = comparableWords(established);
  const head = comparableWords(incoming);
  const limit = Math.min(tail.length, head.length);
  for (let run = limit; run > 0; run--) {
    let matches = true;
    for (let i = 0; i < run; i++) {
      if (tail[tail.length - run + i] !== head[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return run;
  }
  return 0;
}

/**
 * `incoming` with any opening words that merely repeat the end of `established`
 * removed. Punctuation and casing come from the incoming text — only the
 * comparison is normalized. Exported for testing.
 */
export function withoutEcho(established: string, incoming: string): string {
  const echoed = echoedWordCount(established, incoming);
  if (echoed === 0) return incoming.trim();
  return incoming.trim().split(/\s+/).slice(echoed).join(' ');
}

/** Orders `<session>:<index>` keys by when they were spoken. */
function compareKeys(a: string, b: string): number {
  const [aSession, aIndex] = a.split(':').map(Number);
  const [bSession, bIndex] = b.split(':').map(Number);
  return aSession - bSession || aIndex - bIndex;
}

function lastWords(text: string, count: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(-count).join(' ');
}

function joinPhrases(phrases: Iterable<string>): string {
  const parts: string[] = [];
  for (const phrase of phrases) {
    const trimmed = phrase.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join(' ');
}

export class DictationEngine {
  private readonly lang: string;
  private readonly onFailure?: (failure: DictationFailure) => void;
  private readonly now: () => number;

  private readonly listeners = new Set<(state: DictationState) => void>();
  private state: DictationState = IDLE_STATE;

  // Finalized phrases keyed by `<session>:<index within session>`, joined in
  // key order to form the transcript. A browser that redelivers a result lands
  // on the key it already occupies instead of appending a second copy.
  private readonly phrases = new Map<string, string>();
  // Keys that are finished with: banked by the caller, or dropped as echoed
  // audio. The browser keeps replaying a session's whole result list, so
  // without this a phrase would be reconsidered — and re-filed — every time.
  private readonly settled = new Set<string>();
  // Keys of the phrase currently being spoken. Banking has to cover it as well
  // as the finished ones: the caller is showing its interim text, so letting it
  // file itself once the browser finalizes it would hand over the same words a
  // second time.
  private pendingKeys = new Set<string>();
  // The opening words screening removed from a phrase, by key. A browser that
  // redelivers the phrase hands back the untrimmed text, and the cut has to be
  // made again — re-screening can't do it, because the transcript it would be
  // measured against now contains the phrase itself.
  private readonly echoedPrefixes = new Map<string, string>();
  // The end of what has been banked, kept only so a session reopening right
  // after a reset can still recognize the audio it re-hears.
  private bankedTail = '';

  private recognizer: SpeechRecognizer | null = null;
  private reopenTimer: ReturnType<typeof setTimeout> | null = null;

  // What the user asked for, as opposed to whether a session is currently open.
  // The browser closes sessions on its own silence timeout; the run outlives it.
  private wantsToListen = false;

  private sessionSeq = 0;
  private sessionOpenedAt = 0;
  // When the recognizer last reported anything, across sessions.
  private lastHeardAt = 0;
  private sessionHeardSomething = false;
  private stillbornSessions = 0;
  // Phrases still to be screened for echoed audio after a reopen.
  private screeningLeft = 0;

  constructor(options: DictationEngineOptions = {}) {
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

  start = (): void => {
    if (this.wantsToListen) return;
    const Recognizer = findRecognizerConstructor();
    if (!Recognizer) {
      this.onFailure?.({ reason: 'recognizer-error', code: 'unsupported' });
      return;
    }
    this.wantsToListen = true;
    this.stillbornSessions = 0;
    this.lastHeardAt = this.now();
    this.openSession(false);
  };

  stop = (): void => {
    // Intent goes first: closing the recognizer fires onend, which would
    // otherwise read as the browser's silence timeout and reopen the session.
    this.wantsToListen = false;
    this.cancelReopen();
    this.closeRecognizer();
    this.publish({ ...this.state, listening: false, partial: '' });
  };

  toggle = (): void => {
    if (this.wantsToListen) this.stop();
    else this.start();
  };

  /**
   * Forget everything dictated so far without interrupting the run. The chat
   * calls this once it has folded the transcript into the message box, so the
   * same words aren't handed over twice.
   */
  reset = (): void => {
    this.bankedTail = lastWords(this.transcript, ECHO_CONTEXT_WORDS);
    for (const key of this.phrases.keys()) this.settled.add(key);
    for (const key of this.pendingKeys) this.settled.add(key);
    this.pendingKeys.clear();
    this.phrases.clear();
    this.echoedPrefixes.clear();
    this.publish({ ...this.state, transcript: '', partial: '' });
  };

  /** Release the microphone and drop every listener. */
  dispose = (): void => {
    this.wantsToListen = false;
    this.cancelReopen();
    this.closeRecognizer();
    this.listeners.clear();
  };

  private publish(next: DictationState): void {
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

  private get transcript(): string {
    // Sorted rather than relying on insertion order: a phrase can be filed
    // after one that follows it, when an earlier slot was held back for
    // screening and the browser only later replayed it.
    const spoken = [...this.phrases.entries()].sort((a, b) => compareKeys(a[0], b[0]));
    return joinPhrases(spoken.map(([, text]) => text));
  }

  /** What a reopened session's audio is measured against, banked words included. */
  private echoContext(): string {
    return joinPhrases([this.bankedTail, this.transcript]);
  }

  private cancelReopen(): void {
    if (this.reopenTimer !== null) {
      clearTimeout(this.reopenTimer);
      this.reopenTimer = null;
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
    this.cancelReopen();
    this.closeRecognizer();
    this.publish({ ...this.state, listening: false, partial: '' });
    this.onFailure?.(failure);
  }

  /**
   * Open a recognition session. Each one gets its own recognizer object: a
   * session's results are keyed by an index into a list the browser resets
   * anyway, and a fresh object means no handler or flag can survive from the
   * session before it.
   */
  private openSession(isReopen: boolean): void {
    const Recognizer = findRecognizerConstructor();
    if (!Recognizer) return;

    this.closeRecognizer();
    this.sessionSeq += 1;
    this.sessionOpenedAt = this.now();
    this.sessionHeardSomething = false;
    // Cleared on a fresh session as well as set on a reopen: a leftover count
    // would screen the first thing said in a new run against the last run's
    // words and swallow it.
    this.screeningLeft = isReopen ? SCREENED_PHRASES_AFTER_REOPEN : 0;

    const session = this.sessionSeq;
    const recognizer = new Recognizer();
    recognizer.lang = this.lang;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.maxAlternatives = 1;

    recognizer.onstart = () => {
      this.publish({ ...this.state, listening: true });
    };
    recognizer.onresult = event => this.handleResults(session, event);
    recognizer.onerror = event => this.handleError(event);
    recognizer.onend = () => this.handleEnd();

    this.recognizer = recognizer;
    try {
      recognizer.start();
    } catch {
      // Chrome throws InvalidStateError if a recognizer is started twice. The
      // session is unusable either way, so treat it as a session that died.
      this.handleEnd();
    }
  }

  private handleResults(session: number, event: RecognitionResultEvent): void {
    this.sessionHeardSomething = true;
    this.stillbornSessions = 0;
    this.lastHeardAt = this.now();

    const partials: string[] = [];
    const stillSpeaking = new Set<string>();
    for (let index = 0; index < event.results.length; index++) {
      const result = event.results[index];
      const key = `${session}:${index}`;
      // Settled once, settled for good — including a phrase that was still in
      // flight when the caller banked it, whose interim text must stop showing
      // rather than wait to be finalized.
      if (this.settled.has(key)) continue;

      const spoken = (result?.[0]?.transcript ?? '').trim();
      if (!result?.isFinal) {
        if (spoken) {
          partials.push(spoken);
          stillSpeaking.add(key);
        }
        continue;
      }
      if (!spoken) continue;

      // Screening runs against the transcript, so it only works the first time
      // a phrase is filed — by the redelivery that transcript already contains
      // the phrase, and measuring it again would blank it out. A redelivery is
      // instead re-trimmed against the prefix screening took off it, which is
      // still the right cut and leaves a revision that drops the echo itself
      // alone.
      if (this.phrases.has(key)) {
        const echoedPrefix = this.echoedPrefixes.get(key);
        this.phrases.set(key, echoedPrefix ? withoutEcho(echoedPrefix, spoken) : spoken);
        continue;
      }
      if (this.screeningLeft > 0) {
        this.screeningLeft -= 1;
        const words = spoken.split(/\s+/);
        const echoed = echoedWordCount(this.echoContext(), spoken);
        const fresh = words.slice(echoed).join(' ');
        if (!fresh) {
          this.settled.add(key);
          continue;
        }
        if (echoed > 0) this.echoedPrefixes.set(key, words.slice(0, echoed).join(' '));
        this.phrases.set(key, fresh);
        continue;
      }
      this.phrases.set(key, spoken);
    }

    this.pendingKeys = stillSpeaking;
    const transcript = this.transcript;
    const heard = joinPhrases(partials);
    // A session still working through a reopen echoes into its interim results
    // too, so the preview gets the same screening the finals get — otherwise it
    // shows words that are already sitting in the message box.
    const partial = this.screeningLeft > 0 ? withoutEcho(this.echoContext(), heard) : heard;
    this.publish({ listening: true, transcript, partial });
  }

  private handleError(event: RecognitionErrorEvent): void {
    const fatal = FATAL_ERRORS[event.error];
    if (fatal) {
      this.fail({ reason: fatal, code: event.error });
      return;
    }
    // 'aborted' is what stop() itself produces, and 'no-speech' is just a pause.
    // Both leave the run alone and let onend decide whether to reopen.
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    this.fail({ reason: 'recognizer-error', code: event.error });
  }

  private handleEnd(): void {
    if (!this.wantsToListen) {
      this.publish({ ...this.state, listening: false, partial: '' });
      return;
    }

    // "Keep listening until I say stop" can't mean forever: a mic nobody is
    // talking into is left live, and each reopen is another chance to re-hear
    // the tail of what was already said. The transcript survives, so this lands
    // in the message box exactly as if the mic button had been pressed.
    if (this.now() - this.lastHeardAt >= QUIET_RUN_LIMIT_MS) {
      this.stop();
      return;
    }

    // Browsers end a session on their own silence timeout even in continuous
    // mode, so "keep listening until I say stop" means reopening. `listening`
    // deliberately stays true across the gap so the mic button doesn't blink.
    const viable = this.sessionHeardSomething || this.now() - this.sessionOpenedAt >= VIABLE_SESSION_MS;
    this.stillbornSessions = viable ? 0 : this.stillbornSessions + 1;
    if (this.stillbornSessions > MAX_STILLBORN_SESSIONS) {
      this.fail({ reason: 'unstable' });
      return;
    }

    // Deferred: Chrome rejects a start() issued from inside its own onend.
    this.cancelReopen();
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      if (!this.wantsToListen) return;
      this.openSession(true);
    }, 0);
  }
}
