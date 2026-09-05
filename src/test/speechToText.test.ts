import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SpeechToText,
  transcriptOf,
  FINALIZE_GRACE_MS,
  RESTART_DELAY_MS,
  SILENCE_TIMEOUT_MS,
  type SpeechToTextError,
  type SpeechToTextState,
} from '@/utils/speechToText';
import {
  FakeSpeechRecognition,
  installFakeSpeechRecognition,
  uninstallFakeSpeechRecognition,
} from './helpers/fakeSpeechRecognition';

let built: FakeSpeechRecognition[] = [];
const mic = () => built[built.length - 1];

/** Let the engine open the next chained session. */
const chain = () => vi.advanceTimersByTime(RESTART_DELAY_MS);

interface Harness {
  engine: SpeechToText;
  ended: string[];
  errors: SpeechToTextError[];
  states: SpeechToTextState[];
}

function harness(lang?: string): Harness {
  const ended: string[] = [];
  const errors: SpeechToTextError[] = [];
  const states: SpeechToTextState[] = [];
  const engine = new SpeechToText({
    lang,
    onEnd: words => ended.push(words),
    onError: error => errors.push(error),
  });
  engine.subscribe(state => states.push(state));
  return { engine, ended, errors, states };
}

/** A browser session ending on its own after enough time to have been real. */
function endAfterSpeech(recognizer = mic()) {
  vi.advanceTimersByTime(800);
  recognizer.end();
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  built = installFakeSpeechRecognition();
});

afterEach(() => {
  uninstallFakeSpeechRecognition();
  vi.useRealTimers();
});

describe('transcriptOf — the text of one result list', () => {
  const list = (...entries: (string | [string, boolean])[]) => {
    const results = entries.map(entry => {
      const [text, final] = typeof entry === 'string' ? [entry, true] : entry;
      return { 0: { transcript: text }, length: 1, isFinal: final };
    });
    return Object.assign(results, { length: results.length }) as never;
  };

  it('joins entries in order', () => {
    expect(transcriptOf(list('add three sets', 'of squats'))).toBe('add three sets of squats');
  });

  it('is empty for an empty list', () => {
    expect(transcriptOf(list())).toBe('');
  });

  it('skips blank entries and tidies whitespace', () => {
    expect(transcriptOf(list('  add  three ', '   ', ['sets ', false]))).toBe('add three sets');
  });

  it('keeps interim and final entries alike', () => {
    expect(transcriptOf(list('add three sets', ['of squ', false]))).toBe('add three sets of squ');
  });

  it('drops an entry identical to the one before it, whatever its case', () => {
    expect(transcriptOf(list('add three sets', 'Add three sets'))).toBe('add three sets');
  });

  it('lets an entry that begins with the whole previous entry replace it', () => {
    expect(transcriptOf(list('add three sets', 'add three sets of squats'))).toBe(
      'add three sets of squats',
    );
  });

  it('does not treat a shared word prefix as a rewrite', () => {
    expect(transcriptOf(list('add three', 'add threesome'))).toBe('add three add threesome');
  });

  it('keeps a genuine repetition that is not adjacent', () => {
    expect(transcriptOf(list('squats', 'then lunges', 'squats'))).toBe('squats then lunges squats');
  });

  it('keeps an overlapping tail as it was reported — nothing guesses at words', () => {
    // The pathology that continuous mode produced on Android. Single-utterance
    // sessions are how the engine avoids it; this function does not try to.
    expect(transcriptOf(list('add three sets', 'three sets of squats'))).toBe(
      'add three sets three sets of squats',
    );
  });

  it('collapses a chain of cumulative rewrites to the last one', () => {
    expect(transcriptOf(list('add', 'add three', 'add three sets'))).toBe('add three sets');
  });
});

describe('SpeechToText — opening the microphone', () => {
  it('reports the browser has no recognizer', () => {
    uninstallFakeSpeechRecognition();
    expect(harness().engine.supported).toBe(false);
  });

  it('finds the webkit-prefixed recognizer', () => {
    uninstallFakeSpeechRecognition();
    built = installFakeSpeechRecognition('webkitSpeechRecognition');
    const { engine } = harness();
    expect(engine.supported).toBe(true);
    engine.start();
    expect(built).toHaveLength(1);
    expect(engine.getState().listening).toBe(true);
  });

  it('opens a single-utterance session with interim results', () => {
    const { engine } = harness('en-GB');
    engine.start();
    expect(built).toHaveLength(1);
    expect(mic().continuous).toBe(false);
    expect(mic().interimResults).toBe(true);
    expect(mic().maxAlternatives).toBe(1);
    expect(mic().lang).toBe('en-GB');
    expect(mic().live).toBe(true);
    expect(engine.getState()).toEqual({ listening: true, transcript: '' });
  });

  it('ignores a second start while already listening', () => {
    const { engine } = harness();
    engine.start();
    engine.start();
    expect(built).toHaveLength(1);
  });

  it('says so when the browser has no recognizer at all', () => {
    uninstallFakeSpeechRecognition();
    const { engine, errors } = harness();
    engine.start();
    expect(errors).toEqual([{ reason: 'unsupported' }]);
    expect(engine.getState().listening).toBe(false);
  });

  it('survives a recognizer that throws instead of starting', () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function () {
      const recognizer = new FakeSpeechRecognition();
      recognizer.start = () => {
        throw new Error('InvalidStateError');
      };
      built.push(recognizer);
      return recognizer;
    };
    const { engine, errors } = harness();
    expect(() => engine.start()).not.toThrow();
    expect(errors).toEqual([{ reason: 'no-start' }]);
    expect(engine.getState().listening).toBe(false);
  });

  it('reports a first session that dies on the spot as not having started', () => {
    const { engine, errors, ended } = harness();
    engine.start();
    mic().end();
    expect(errors).toEqual([{ reason: 'no-start' }]);
    expect(ended).toEqual([]);
    expect(engine.getState().listening).toBe(false);
  });

  it('does not call a silence that lasted a while a failure to start', () => {
    const { engine, errors } = harness();
    engine.start();
    vi.advanceTimersByTime(5000);
    mic().end();
    expect(errors).toEqual([]);
    expect(engine.getState().listening).toBe(false);
  });
});

describe('SpeechToText — what one session reports', () => {
  it('previews the phrase in flight and keeps it when it finalizes', () => {
    const { engine } = harness();
    engine.start();
    mic().interim('add three');
    expect(engine.getState().transcript).toBe('add three');
    mic().interim('add three sets');
    expect(engine.getState().transcript).toBe('add three sets');
    mic().final('add three sets of squats');
    expect(engine.getState().transcript).toBe('add three sets of squats');
  });

  it('writes a phrase once however often the browser replays it', () => {
    const { engine } = harness();
    engine.start();
    mic().final('bench press');
    mic().replay();
    mic().replay();
    mic().replay();
    expect(engine.getState().transcript).toBe('bench press');
  });

  it('takes a revision of an earlier entry', () => {
    const { engine } = harness();
    engine.start();
    mic().final('bench press');
    mic().final('machine');
    mic().revise(0, 'bench press on the');
    expect(engine.getState().transcript).toBe('bench press on the machine');
  });

  it("does not double Android's second copy of a final result", () => {
    const { engine } = harness();
    engine.start();
    mic().final('add three sets of squats');
    mic().duplicateFinal();
    mic().replay();
    expect(engine.getState().transcript).toBe('add three sets of squats');
  });

  it('does not double a recognizer that reports cumulatively', () => {
    const { engine } = harness();
    engine.start();
    mic().final('add three sets');
    mic().cumulative('of squats');
    expect(engine.getState().transcript).toBe('add three sets of squats');
    mic().cumulative('and lunges', true);
    expect(engine.getState().transcript).toBe('add three sets of squats and lunges');
  });

  it('follows a list that starts over rather than doubling it', () => {
    const { engine } = harness();
    engine.start();
    mic().final('add three sets');
    mic().restartList('of squats');
    // Within one session the newest list is the whole truth.
    expect(engine.getState().transcript).toBe('of squats');
  });

  it('holds the same state object until something actually changes', () => {
    const { engine } = harness();
    engine.start();
    mic().final('squats');
    const before = engine.getState();
    mic().replay();
    expect(engine.getState()).toBe(before);
  });

  it('stops notifying a listener once it unsubscribes', () => {
    const { engine } = harness();
    const seen: string[] = [];
    const unsubscribe = engine.subscribe(state => seen.push(state.transcript));
    engine.start();
    mic().final('squats');
    unsubscribe();
    mic().final('and lunges');
    expect(seen.at(-1)).toBe('squats');
    expect(engine.getState().transcript).toBe('squats and lunges');
  });
});

describe('SpeechToText — chaining sessions while the user keeps talking', () => {
  it('opens the next session when the browser ends one that heard speech', () => {
    const { engine } = harness();
    engine.start();
    mic().final('add three sets');
    endAfterSpeech();
    expect(engine.getState()).toEqual({ listening: true, transcript: 'add three sets' });
    expect(built).toHaveLength(1);

    vi.advanceTimersByTime(RESTART_DELAY_MS - 1);
    expect(built).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(built).toHaveLength(2);
    expect(mic().live).toBe(true);
    expect(mic().continuous).toBe(false);
    expect(engine.getState()).toEqual({ listening: true, transcript: 'add three sets' });
  });

  it('carries the next session on after the last one, in order', () => {
    const { engine } = harness();
    engine.start();
    mic().final('add three sets');
    endAfterSpeech();
    chain();
    mic().interim('of');
    expect(engine.getState().transcript).toBe('add three sets of');
    mic().final('of squats');
    endAfterSpeech();
    chain();
    mic().final('and lunges');
    expect(engine.getState().transcript).toBe('add three sets of squats and lunges');
  });

  it('keeps a phrase the browser ended a session on before finalizing', () => {
    const { engine } = harness();
    engine.start();
    mic().interim('add three sets');
    endAfterSpeech();
    chain();
    mic().final('of squats');
    expect(engine.getState().transcript).toBe('add three sets of squats');
  });

  it('ignores a departed session reporting after the run moved on', () => {
    const { engine } = harness();
    engine.start();
    const first = mic();
    first.final('add three sets');
    endAfterSpeech(first);
    chain();
    first.lateReport('add three sets');
    first.end();
    mic().final('of squats');
    expect(engine.getState().transcript).toBe('add three sets of squats');
    expect(built).toHaveLength(2);
  });

  it('ends the run when a chained session hears nothing — that is the silence', () => {
    const { engine, ended, errors } = harness();
    engine.start();
    mic().final('add three sets of squats');
    endAfterSpeech();
    chain();
    vi.advanceTimersByTime(6000);
    mic().error('no-speech');
    mic().end();

    expect(engine.getState()).toEqual({ listening: false, transcript: '' });
    expect(ended).toEqual(['add three sets of squats']);
    expect(errors).toEqual([]);
    chain();
    expect(built).toHaveLength(2);
  });

  it('ends the run quietly when a chained session dies on the spot', () => {
    const { engine, ended, errors } = harness();
    engine.start();
    mic().final('add squats');
    endAfterSpeech();
    chain();
    mic().end();

    expect(ended).toEqual(['add squats']);
    expect(errors).toEqual([]);
    expect(engine.getState().listening).toBe(false);
  });

  it('ends the run when nothing has been reported for a while', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add squats');
    vi.advanceTimersByTime(SILENCE_TIMEOUT_MS - 1);
    expect(engine.getState().listening).toBe(true);
    vi.advanceTimersByTime(1);

    expect(engine.getState()).toEqual({ listening: false, transcript: '' });
    expect(ended).toEqual(['add squats']);
    expect(built[0].aborted).toBe(true);
  });

  it('measures the silence from the last report, not the start', () => {
    const { engine } = harness();
    engine.start();
    vi.advanceTimersByTime(SILENCE_TIMEOUT_MS - 1000);
    mic().interim('add');
    vi.advanceTimersByTime(SILENCE_TIMEOUT_MS - 1000);
    expect(engine.getState().listening).toBe(true);
  });

  it('gives a chained session its own silence allowance', () => {
    const { engine } = harness();
    engine.start();
    mic().final('add squats');
    vi.advanceTimersByTime(SILENCE_TIMEOUT_MS - 2000);
    endAfterSpeech();
    chain();
    vi.advanceTimersByTime(SILENCE_TIMEOUT_MS - 500);
    expect(engine.getState().listening).toBe(true);
    vi.advanceTimersByTime(500);
    expect(engine.getState().listening).toBe(false);
  });
});

describe('SpeechToText — the mic button ending a run', () => {
  it('switches off at once and hands the words over when the browser finalizes', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().interim('add three sets of squ');
    engine.stop();

    expect(engine.getState()).toEqual({ listening: false, transcript: 'add three sets of squ' });
    expect(mic().stopping).toBe(true);
    expect(ended).toEqual([]);

    mic().final('add three sets of squats');
    expect(engine.getState().transcript).toBe('add three sets of squats');
    mic().end();
    expect(ended).toEqual(['add three sets of squats']);
    expect(engine.getState()).toEqual({ listening: false, transcript: '' });
  });

  it('takes the phrase in flight as it stands if the browser never finalizes it', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().interim('add three sets');
    engine.stop();
    vi.advanceTimersByTime(FINALIZE_GRACE_MS - 1);
    expect(ended).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ended).toEqual(['add three sets']);
    expect(mic().aborted).toBe(true);
  });

  it('hands over every session of the run, in order', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add three sets');
    endAfterSpeech();
    chain();
    mic().final('of squats');
    engine.stop();
    mic().end();
    expect(ended).toEqual(['add three sets of squats']);
  });

  it('ends at once when pressed between sessions', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add squats');
    endAfterSpeech();
    engine.stop();
    expect(ended).toEqual(['add squats']);
    expect(engine.getState()).toEqual({ listening: false, transcript: '' });
    chain();
    expect(built).toHaveLength(1);
  });

  it('hands nothing over when nothing was said', () => {
    const { engine, ended } = harness();
    engine.start();
    engine.stop();
    mic().end();
    expect(ended).toEqual([]);
    expect(engine.getState()).toEqual({ listening: false, transcript: '' });
  });

  it('hands the words over once, however many times it is pressed', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add squats');
    engine.stop();
    engine.stop();
    mic().end();
    engine.stop();
    vi.advanceTimersByTime(FINALIZE_GRACE_MS);
    expect(ended).toEqual(['add squats']);
  });

  it('lets a fatal error during the wait end the run with the words', () => {
    const { engine, ended, errors } = harness();
    engine.start();
    mic().final('add squats');
    engine.stop();
    mic().error('not-allowed');
    expect(ended).toEqual(['add squats']);
    expect(errors).toEqual([{ reason: 'denied', code: 'not-allowed' }]);
  });

  it('starts a fresh run while the last is still closing, handing its words over first', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add squats');
    engine.stop();
    engine.start();

    expect(ended).toEqual(['add squats']);
    expect(built).toHaveLength(2);
    expect(engine.getState()).toEqual({ listening: true, transcript: '' });
    mic().final('add squats');
    // The same words said again are a new sentence, not a repeat of the old one.
    expect(engine.getState().transcript).toBe('add squats');
  });

  it('starts a new run empty, whatever the last one heard', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add three sets');
    engine.stop();
    mic().end();
    engine.start();
    expect(engine.getState()).toEqual({ listening: true, transcript: '' });
    mic().final('and lunges');
    engine.stop();
    mic().end();
    expect(ended).toEqual(['add three sets', 'and lunges']);
  });

  it('toggles between listening and stopped', () => {
    const { engine } = harness();
    engine.toggle();
    expect(engine.getState().listening).toBe(true);
    engine.toggle();
    expect(engine.getState().listening).toBe(false);
  });

  it('treats a stop the browser throws on as the end', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add squats');
    mic().stop = () => {
      throw new Error('InvalidStateError');
    };
    engine.stop();
    expect(ended).toEqual(['add squats']);
  });
});

describe('SpeechToText — cancelling and disposing', () => {
  it('forgets the words on cancel and hands nothing over', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add three sets');
    endAfterSpeech();
    chain();
    mic().interim('of squats');
    engine.cancel();

    expect(ended).toEqual([]);
    expect(engine.getState()).toEqual({ listening: false, transcript: '' });
    expect(mic().aborted).toBe(true);
  });

  it('lets nothing from a cancelled session come back', () => {
    const { engine, ended } = harness();
    engine.start();
    const first = mic();
    first.interim('add three sets');
    engine.cancel();
    first.final('add three sets of squats');
    first.end();
    vi.advanceTimersByTime(FINALIZE_GRACE_MS + SILENCE_TIMEOUT_MS);

    expect(engine.getState()).toEqual({ listening: false, transcript: '' });
    expect(ended).toEqual([]);
    expect(built).toHaveLength(1);
  });

  it('cancels a run that is closing', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add squats');
    engine.stop();
    engine.cancel();
    vi.advanceTimersByTime(FINALIZE_GRACE_MS);
    expect(ended).toEqual([]);
  });

  it('is a no-op when idle', () => {
    const { engine, ended, states } = harness();
    engine.cancel();
    engine.stop();
    expect(ended).toEqual([]);
    expect(states).toEqual([]);
  });

  it('releases the microphone on dispose and stays usable afterwards', () => {
    const { engine, ended } = harness();
    engine.start();
    engine.dispose();
    expect(mic().aborted).toBe(true);
    expect(ended).toEqual([]);

    engine.start();
    expect(built).toHaveLength(2);
    expect(engine.getState().listening).toBe(true);
  });
});

describe('SpeechToText — failures', () => {
  it('stops for good on a denied microphone', () => {
    const { engine, errors } = harness();
    engine.start();
    mic().error('not-allowed');
    mic().end();
    chain();
    expect(errors).toEqual([{ reason: 'denied', code: 'not-allowed' }]);
    expect(engine.getState().listening).toBe(false);
    expect(built).toHaveLength(1);
  });

  it('ends quietly when a chained session is refused at once — Android reporting busy as denied', () => {
    const { engine, errors, ended } = harness();
    engine.start();
    mic().final('add three sets of squats');
    endAfterSpeech();
    chain();
    mic().error('not-allowed');
    mic().end();

    expect(errors).toEqual([]);
    expect(ended).toEqual(['add three sets of squats']);
    expect(engine.getState()).toEqual({ listening: false, transcript: '' });
    chain();
    expect(built).toHaveLength(2);
  });

  it('still reports a denial that reaches a chained session after it was listening', () => {
    const { engine, errors, ended } = harness();
    engine.start();
    mic().final('add squats');
    endAfterSpeech();
    chain();
    vi.advanceTimersByTime(2000);
    mic().error('not-allowed');

    expect(errors).toEqual([{ reason: 'denied', code: 'not-allowed' }]);
    expect(ended).toEqual(['add squats']);
  });

  it('reports a missing microphone', () => {
    const { engine, errors } = harness();
    engine.start();
    mic().error('audio-capture');
    expect(errors).toEqual([{ reason: 'no-microphone', code: 'audio-capture' }]);
  });

  it('passes an unfamiliar error through with its code, keeping what was said', () => {
    const { engine, errors, ended } = harness();
    engine.start();
    mic().final('add three sets');
    mic().error('network');
    expect(errors).toEqual([{ reason: 'recognizer-error', code: 'network' }]);
    expect(ended).toEqual(['add three sets']);
    expect(engine.getState().listening).toBe(false);
  });

  it('lets the browser giving up on silence end the run quietly', () => {
    const { engine, errors, ended } = harness();
    engine.start();
    vi.advanceTimersByTime(8000);
    mic().error('no-speech');
    mic().end();
    expect(errors).toEqual([]);
    expect(ended).toEqual([]);
    expect(engine.getState().listening).toBe(false);
  });

  it('ignores the abort error its own closing produces', () => {
    const { engine, errors } = harness();
    engine.start();
    mic().final('add squats');
    const first = mic();
    engine.stop();
    first.error('aborted');
    expect(errors).toEqual([]);
  });

  it('delivers the words once even when an error and an end both arrive', () => {
    const { engine, ended } = harness();
    engine.start();
    mic().final('add squats');
    const first = mic();
    first.error('network');
    first.end();
    vi.advanceTimersByTime(SILENCE_TIMEOUT_MS);
    expect(ended).toEqual(['add squats']);
  });
});

/**
 * Browsers as event generators. Each speaks the same phrases through the
 * engine in its own way — replays, duplicate finals, cumulative interims,
 * instant ends — and the run must hand back exactly those phrases, once
 * each, in order. Seeded so a failure is reproducible.
 */
describe('SpeechToText — every browser, every phrase once', () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const WORDS = ['add', 'three', 'sets', 'of', 'squats', 'and', 'lunges', 'to', 'push', 'day', 'bench', 'press', 'swap', 'the', 'rows', 'for', 'pull', 'ups', 'squats', 'sets'];

  function phrase(random: () => number): string {
    const count = 2 + Math.floor(random() * 6);
    const words: string[] = [];
    for (let i = 0; i < count; i++) words.push(WORDS[Math.floor(random() * WORDS.length)]);
    return words.join(' ');
  }

  /** The speaker: each phrase said into the current session, browser-style. */
  type Personality = (random: () => number, said: string, engine: SpeechToText) => void;

  const speakInterims = (random: () => number, said: string) => {
    const words = said.split(' ');
    for (let n = 1; n < words.length; n++) {
      if (random() < 0.7) mic().interim(words.slice(0, n).join(' '));
      if (random() < 0.3) mic().replay();
    }
  };

  const chromeDesktop: Personality = (random, said) => {
    speakInterims(random, said);
    mic().final(said);
    if (random() < 0.5) mic().replay();
    endAfterSpeech();
  };

  const chromeAndroid: Personality = (random, said) => {
    speakInterims(random, said);
    mic().final(said);
    if (random() < 0.6) mic().duplicateFinal();
    if (random() < 0.5) mic().replay();
    endAfterSpeech();
  };

  const cumulativeRecognizer: Personality = (random, said) => {
    // Every report is the whole phrase so far, sometimes as new entries.
    const words = said.split(' ');
    let listed = '';
    for (let n = 1; n <= words.length; n++) {
      const sofar = words.slice(0, n).join(' ');
      if (random() < 0.4 && listed) {
        mic().cumulative(words.slice(listed.split(' ').length, n).join(' '), n === words.length);
      } else {
        if (n === words.length) mic().final(sofar);
        else mic().interim(sofar);
      }
      listed = sofar;
    }
    // Safari re-emits the final on its way out.
    if (random() < 0.5) mic().duplicateFinal();
    endAfterSpeech();
  };

  const impatientBrowser: Personality = (random, said) => {
    // Ends the session before finalizing; the next session opens under it.
    speakInterims(random, said);
    if (random() < 0.5) mic().interim(said);
    else mic().final(said);
    endAfterSpeech();
  };

  const PERSONALITIES: Record<string, Personality> = {
    chromeDesktop,
    chromeAndroid,
    cumulativeRecognizer,
    impatientBrowser,
  };

  for (const [name, speak] of Object.entries(PERSONALITIES)) {
    it(`${name}: hands back exactly what was said, ended by the button or by silence`, () => {
      for (let seed = 1; seed <= 60; seed++) {
        const random = rng(seed * 7919 + name.length);
        const { engine, ended, errors } = harness();
        const phrases: string[] = [];
        engine.start();
        const count = 1 + Math.floor(random() * 4);
        for (let i = 0; i < count; i++) {
          const said = phrase(random);
          phrases.push(said);
          speak(random, said, engine);
          chain();
        }
        if (random() < 0.5) {
          engine.stop();
          if (random() < 0.5) mic().end();
          else vi.advanceTimersByTime(FINALIZE_GRACE_MS);
        } else {
          vi.advanceTimersByTime(6000);
          mic().error('no-speech');
          mic().end();
        }
        expect(errors, `seed ${seed}`).toEqual([]);
        expect(ended, `seed ${seed}`).toEqual([phrases.join(' ')]);
        expect(engine.getState(), `seed ${seed}`).toEqual({ listening: false, transcript: '' });
      }
    });
  }

  it('never shows a word twice on screen along the way', () => {
    // At every report, the transcript on screen is the phrases finished so far
    // plus a prefix of the one in flight — the exact text, never an echo.
    for (let seed = 1; seed <= 40; seed++) {
      const random = rng(seed);
      const { engine } = harness();
      engine.start();
      const done: string[] = [];
      const count = 1 + Math.floor(random() * 3);
      for (let i = 0; i < count; i++) {
        const said = phrase(random);
        const words = said.split(' ');
        for (let n = 1; n <= words.length; n++) {
          const sofar = words.slice(0, n).join(' ');
          if (n === words.length) mic().final(sofar);
          else mic().interim(sofar);
          if (random() < 0.3) mic().replay();
          if (n === words.length && random() < 0.5) mic().duplicateFinal();
          const expected = [...done, sofar].join(' ');
          expect(engine.getState().transcript, `seed ${seed}`).toBe(expected);
        }
        done.push(said);
        endAfterSpeech();
        chain();
      }
      engine.cancel();
    }
  });
});
