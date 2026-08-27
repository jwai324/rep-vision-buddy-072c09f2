import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DictationEngine,
  echoedWordCount,
  withoutEcho,
  type DictationFailure,
  type DictationState,
  type SpeechRecognizer,
} from '@/utils/dictationEngine';

/**
 * Stand-in for the browser recognizer. Tests drive it directly: `speak` reports
 * results the way Chrome does (a cumulative list for the session), `timeOut`
 * is the browser closing a session on its own after silence.
 */
class FakeRecognizer implements SpeechRecognizer {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: SpeechRecognizer['onstart'] = null;
  onend: SpeechRecognizer['onend'] = null;
  onerror: SpeechRecognizer['onerror'] = null;
  onresult: SpeechRecognizer['onresult'] = null;
  live = false;

  start() {
    this.live = true;
    this.onstart?.(new Event('start'));
  }
  stop() {
    this.live = false;
    this.onend?.(new Event('end'));
  }
  abort() {
    this.live = false;
  }

  timeOut() {
    this.live = false;
    this.onend?.(new Event('end'));
  }

  fail(error: string) {
    this.onerror?.({ error });
  }

  speak(phrases: { text: string; final: boolean }[]) {
    const results = phrases.map(phrase => {
      const result = { 0: { transcript: phrase.text }, length: 1, isFinal: phrase.final };
      return result;
    });
    this.onresult?.({
      results: Object.assign(results, { length: results.length }) as never,
    });
  }
}

let built: FakeRecognizer[] = [];
let clock = 0;

function install() {
  built = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function () {
    const recognizer = new FakeRecognizer();
    built.push(recognizer);
    return recognizer;
  };
}

/** The engine defers reopening a session by a turn of the event loop. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const newest = () => built[built.length - 1];

function makeEngine(onFailure?: (failure: DictationFailure) => void) {
  return new DictationEngine({ onFailure, now: () => clock });
}

beforeEach(() => {
  clock = 0;
  install();
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('echo trimming', () => {
  it('reports no overlap between unrelated text', () => {
    expect(echoedWordCount('add three sets', 'of squats')).toBe(0);
  });

  it('matches the longest repeated run, not the first', () => {
    expect(echoedWordCount('add three sets', 'three sets of squats')).toBe(2);
  });

  it('ignores casing and punctuation, which two passes disagree on', () => {
    expect(withoutEcho('add three sets', 'Three sets, of squats')).toBe('of squats');
  });

  it('spans phrases the engine filed separately', () => {
    expect(withoutEcho('add three sets of squats', 'three sets of squats and a plank')).toBe(
      'and a plank',
    );
  });

  it('empties a phrase that is nothing but a repeat', () => {
    expect(withoutEcho('add three sets', 'add three sets')).toBe('');
  });

  it('leaves a phrase alone when nothing has been said yet', () => {
    expect(withoutEcho('', 'add three sets')).toBe('add three sets');
  });
});

describe('DictationEngine', () => {
  it('reports the browser has no recognizer', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const engine = makeEngine();
    expect(engine.supported).toBe(false);
  });

  it('finds the webkit-prefixed recognizer', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      function () {
        const recognizer = new FakeRecognizer();
        built.push(recognizer);
        return recognizer;
      };
    const engine = makeEngine();
    expect(engine.supported).toBe(true);
    engine.start();
    expect(engine.getState().listening).toBe(true);
  });

  it('opens a continuous session with interim results on start', () => {
    const engine = makeEngine();
    engine.start();
    expect(built).toHaveLength(1);
    expect(newest().continuous).toBe(true);
    expect(newest().interimResults).toBe(true);
    expect(newest().live).toBe(true);
    expect(engine.getState().listening).toBe(true);
  });

  it('collects finalized phrases into one transcript and previews the phrase in flight', () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'add three sets', final: true }]);
    expect(engine.getState()).toMatchObject({ transcript: 'add three sets', partial: '' });

    newest().speak([
      { text: 'add three sets', final: true },
      { text: 'of squats', final: false },
    ]);
    expect(engine.getState()).toMatchObject({ transcript: 'add three sets', partial: 'of squats' });

    newest().speak([
      { text: 'add three sets', final: true },
      { text: 'of squats', final: true },
    ]);
    expect(engine.getState()).toMatchObject({
      transcript: 'add three sets of squats',
      partial: '',
    });
  });

  it('files a redelivered phrase in the slot it already holds', () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'bench press', final: true }]);
    newest().speak([{ text: 'bench press', final: true }]);
    newest().speak([{ text: 'bench press', final: true }]);
    expect(engine.getState().transcript).toBe('bench press');
  });

  it('takes a revised phrase over the one it replaces', () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'bench press', final: true }]);
    newest().speak([{ text: 'bench press machine', final: true }]);
    expect(engine.getState().transcript).toBe('bench press machine');
  });

  it('notifies subscribers on change and stops once they unsubscribe', () => {
    const engine = makeEngine();
    const seen: DictationState[] = [];
    const unsubscribe = engine.subscribe(state => seen.push(state));
    engine.start();
    newest().speak([{ text: 'squats', final: true }]);
    expect(seen.at(-1)?.transcript).toBe('squats');

    unsubscribe();
    newest().speak([
      { text: 'squats', final: true },
      { text: 'and lunges', final: true },
    ]);
    expect(seen.at(-1)?.transcript).toBe('squats');
    expect(engine.getState().transcript).toBe('squats and lunges');
  });

  it('holds the same state object until something actually changes', () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'squats', final: true }]);
    const first = engine.getState();
    newest().speak([{ text: 'squats', final: true }]);
    expect(engine.getState()).toBe(first);
  });

  it('reopens a session the browser timed out, without dropping the transcript', async () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'add three sets', final: true }]);

    clock += 4000;
    newest().timeOut();
    // The mic button must not blink while the session is being reopened.
    expect(engine.getState().listening).toBe(true);
    await settle();

    expect(built).toHaveLength(2);
    expect(newest().live).toBe(true);
    expect(engine.getState().transcript).toBe('add three sets');
  });

  it('drops audio a reopened session re-hears', async () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'add three sets', final: true }]);
    clock += 4000;
    newest().timeOut();
    await settle();

    // Chrome hands the tail of the old session's audio to the new one, often
    // running on into what was said next.
    newest().speak([{ text: 'three sets of squats', final: true }]);
    expect(engine.getState().transcript).toBe('add three sets of squats');
  });

  it('screens the reopened preview too, so it does not show words already banked', async () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'add three sets', final: true }]);
    clock += 4000;
    newest().timeOut();
    await settle();

    newest().speak([{ text: 'add three sets of', final: false }]);
    expect(engine.getState().partial).toBe('of');
  });

  it('keeps a phrase genuinely repeated later in a reopened session', async () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'squats', final: true }]);
    clock += 4000;
    newest().timeOut();
    await settle();

    // First two phrases are screened; by the third the user is plainly talking.
    newest().speak([{ text: 'squats', final: true }]);
    newest().speak([
      { text: 'squats', final: true },
      { text: 'then lunges', final: true },
    ]);
    newest().speak([
      { text: 'squats', final: true },
      { text: 'then lunges', final: true },
      { text: 'squats', final: true },
    ]);
    expect(engine.getState().transcript).toBe('squats then lunges squats');
  });

  it('stops for good on a denied microphone instead of reopening into it', async () => {
    const onFailure = vi.fn();
    const engine = makeEngine(onFailure);
    engine.start();
    newest().fail('not-allowed');
    await settle();

    expect(onFailure).toHaveBeenCalledWith({ reason: 'denied', code: 'not-allowed' });
    expect(engine.getState().listening).toBe(false);
    expect(built).toHaveLength(1);
  });

  it('reports a missing microphone', async () => {
    const onFailure = vi.fn();
    const engine = makeEngine(onFailure);
    engine.start();
    newest().fail('audio-capture');
    await settle();
    expect(onFailure).toHaveBeenCalledWith({ reason: 'no-microphone', code: 'audio-capture' });
  });

  it('passes an unfamiliar error through with its code', async () => {
    const onFailure = vi.fn();
    const engine = makeEngine(onFailure);
    engine.start();
    newest().fail('network');
    await settle();
    expect(onFailure).toHaveBeenCalledWith({ reason: 'recognizer-error', code: 'network' });
    expect(engine.getState().listening).toBe(false);
  });

  it('treats a pause as a pause, not a failure', async () => {
    const onFailure = vi.fn();
    const engine = makeEngine(onFailure);
    engine.start();
    newest().fail('no-speech');
    clock += 4000;
    newest().timeOut();
    await settle();

    expect(onFailure).not.toHaveBeenCalled();
    expect(engine.getState().listening).toBe(true);
    expect(built).toHaveLength(2);
  });

  it('gives up when sessions keep dying without hearing anything', async () => {
    const onFailure = vi.fn();
    const engine = makeEngine(onFailure);
    engine.start();

    for (let attempt = 0; attempt < 6; attempt++) {
      newest().timeOut();
      await settle();
    }

    expect(onFailure).toHaveBeenCalledWith({ reason: 'unstable' });
    expect(engine.getState().listening).toBe(false);
    const openedBeforeGivingUp = built.length;
    await settle();
    expect(built).toHaveLength(openedBeforeGivingUp);
  });

  it('does not count a long silent session against the run', async () => {
    const onFailure = vi.fn();
    const engine = makeEngine(onFailure);
    engine.start();

    for (let attempt = 0; attempt < 8; attempt++) {
      clock += 4000;
      newest().timeOut();
      await settle();
    }

    expect(onFailure).not.toHaveBeenCalled();
    expect(engine.getState().listening).toBe(true);
  });

  it('stays stopped after stop, even though closing fires the browser end event', async () => {
    const engine = makeEngine();
    engine.start();
    engine.stop();
    await settle();

    expect(engine.getState().listening).toBe(false);
    expect(built).toHaveLength(1);
    expect(newest().live).toBe(false);
  });

  it('keeps the transcript after stopping so the caller can bank it', () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'add three sets', final: true }]);
    engine.stop();
    expect(engine.getState().transcript).toBe('add three sets');
    expect(engine.getState().partial).toBe('');
  });

  it('cancels a queued reopen when stopped in the gap between sessions', async () => {
    const engine = makeEngine();
    engine.start();
    clock += 4000;
    newest().timeOut();
    engine.stop();
    await settle();

    expect(built).toHaveLength(1);
    expect(engine.getState().listening).toBe(false);
  });

  it('clears the transcript on reset without ending the run', () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'add three sets', final: true }]);
    engine.reset();

    expect(engine.getState()).toMatchObject({ transcript: '', listening: true });
    newest().speak([
      { text: 'add three sets', final: true },
      { text: 'of squats', final: true },
    ]);
    // The banked phrase must not come back just because the browser replayed it.
    expect(engine.getState().transcript).toBe('of squats');
  });

  it('banks the phrase still being spoken, so finalizing it adds nothing back', () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'add three sets', final: false }]);
    // The caller has the interim text on screen and banks it as it stands.
    engine.reset();
    expect(engine.getState().partial).toBe('');

    newest().speak([{ text: 'add three sets', final: true }]);
    expect(engine.getState()).toMatchObject({ transcript: '', partial: '' });

    newest().speak([
      { text: 'add three sets', final: true },
      { text: 'of squats', final: false },
    ]);
    expect(engine.getState().partial).toBe('of squats');
  });

  it('stops previewing a banked phrase that is still in flight', () => {
    const engine = makeEngine();
    engine.start();
    newest().speak([{ text: 'add three', final: false }]);
    engine.reset();

    // The browser goes on refining the same interim result.
    newest().speak([{ text: 'add three sets', final: false }]);
    expect(engine.getState().partial).toBe('');
  });

  it('toggles between running and stopped', () => {
    const engine = makeEngine();
    engine.toggle();
    expect(engine.getState().listening).toBe(true);
    engine.toggle();
    expect(engine.getState().listening).toBe(false);
  });

  it('ignores a second start while already running', () => {
    const engine = makeEngine();
    engine.start();
    engine.start();
    expect(built).toHaveLength(1);
  });

  it('releases the microphone on dispose', async () => {
    const engine = makeEngine();
    engine.start();
    const recognizer = newest();
    engine.dispose();
    await settle();

    expect(recognizer.live).toBe(false);
    expect(built).toHaveLength(1);
  });

  it('survives a recognizer that throws on start', () => {
    const engine = makeEngine();
    engine.start();
    const throwing = newest();
    throwing.start = () => {
      throw new Error('InvalidStateError');
    };
    expect(() => engine.start()).not.toThrow();
  });
});
