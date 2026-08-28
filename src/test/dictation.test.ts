import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Dictation,
  type DictationFailure,
  type DictationState,
  type SpeechRecognizer,
} from '@/utils/dictation';

/**
 * Stand-in for the browser recognizer, modelled on Chrome: a session keeps one
 * cumulative list of results, and every report hands back the *whole* list —
 * the phrases it finalized earlier included. Redelivery is therefore not a
 * special case in these tests, it is what `speaking` and `said` do every time.
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

  private results: { text: string; final: boolean }[] = [];
  // The handler as it stood when the session opened, so a report can be
  // delivered the way a browser would deliver one it had already queued.
  private captured: SpeechRecognizer['onresult'] = null;

  start() {
    this.live = true;
    this.captured = this.onresult;
    this.onstart?.(new Event('start'));
  }
  stop() {
    this.live = false;
    this.onend?.(new Event('end'));
  }
  abort() {
    this.live = false;
  }

  /** The browser closing the session on its own silence timeout. */
  timeOut() {
    this.live = false;
    this.onend?.(new Event('end'));
  }

  fail(error: string) {
    this.onerror?.({ error });
  }

  /** The phrase in flight, refined as the speaker goes on. */
  speaking(text: string) {
    this.write(text, false);
  }

  /** That phrase finalized. */
  said(text: string) {
    this.write(text, true);
  }

  /** Report the list again with nothing new in it. */
  replay() {
    this.report();
  }

  /** A phrase reaching the engine after it has moved on to another session. */
  saidLate(text: string) {
    this.results.push({ text, final: true });
    this.report(this.captured);
  }

  private write(text: string, final: boolean) {
    const open = this.results.length - 1;
    if (open >= 0 && !this.results[open].final) this.results[open] = { text, final };
    else this.results.push({ text, final });
    this.report();
  }

  private report(handler = this.onresult) {
    const results = this.results.map(result => ({
      0: { transcript: result.text },
      length: 1,
      isFinal: result.final,
    }));
    handler?.({ results: Object.assign(results, { length: results.length }) as never });
  }
}

let built: FakeRecognizer[] = [];
let clock = 0;

const newest = () => built[built.length - 1];
/** The engine defers reopening a session by a turn of the event loop. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function install() {
  built = [];
  (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function () {
    const recognizer = new FakeRecognizer();
    built.push(recognizer);
    return recognizer;
  };
}

function makeDictation(onFailure?: (failure: DictationFailure) => void) {
  return new Dictation({ onFailure, now: () => clock });
}

/** The browser closing the session on its own after a silence. */
function timeOut() {
  clock += 4000;
  newest().timeOut();
}

beforeEach(() => {
  clock = 0;
  install();
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe('Dictation — what the browser reports', () => {
  it('reports the browser has no recognizer', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    expect(makeDictation().supported).toBe(false);
  });

  it('finds the webkit-prefixed recognizer', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    (window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition =
      function () {
        const recognizer = new FakeRecognizer();
        built.push(recognizer);
        return recognizer;
      };
    const dictation = makeDictation();
    expect(dictation.supported).toBe(true);
    dictation.start();
    expect(dictation.getState().listening).toBe(true);
  });

  it('opens a continuous session with interim results', () => {
    const dictation = makeDictation();
    dictation.start();
    expect(built).toHaveLength(1);
    expect(newest().continuous).toBe(true);
    expect(newest().interimResults).toBe(true);
    expect(newest().live).toBe(true);
    expect(dictation.getState().listening).toBe(true);
  });

  it('previews the phrase in flight and banks it when it finalizes', () => {
    const dictation = makeDictation();
    dictation.start();

    newest().speaking('add three');
    expect(dictation.getState()).toMatchObject({ transcript: '', partial: 'add three' });

    newest().speaking('add three sets');
    expect(dictation.getState()).toMatchObject({ transcript: '', partial: 'add three sets' });

    newest().said('add three sets');
    expect(dictation.getState()).toMatchObject({ transcript: 'add three sets', partial: '' });
  });

  it('joins one phrase to the next', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('add three sets');
    newest().said('of squats');
    newest().speaking('and a');

    expect(dictation.getState()).toMatchObject({
      transcript: 'add three sets of squats',
      partial: 'and a',
    });
  });

  it('writes a phrase once however often the browser replays it', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('bench press');
    newest().replay();
    newest().replay();
    newest().replay();

    expect(dictation.getState().transcript).toBe('bench press');
  });

  it('takes a phrase the browser goes back and revises', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('bench press');
    newest().said('machine');
    // A revision arrives as the same list with an earlier entry rewritten.
    const revised = newest() as unknown as { results: { text: string; final: boolean }[] };
    revised.results[0].text = 'bench press on the';
    newest().replay();

    expect(dictation.getState().transcript).toBe('bench press on the machine');
  });

  it('holds the same state object until something actually changes', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('squats');
    const first = dictation.getState();
    newest().replay();
    expect(dictation.getState()).toBe(first);
  });

  it('notifies subscribers on change and stops once they unsubscribe', () => {
    const dictation = makeDictation();
    const seen: DictationState[] = [];
    const unsubscribe = dictation.subscribe(state => seen.push(state));
    dictation.start();
    newest().said('squats');
    expect(seen.at(-1)?.transcript).toBe('squats');

    unsubscribe();
    newest().said('and lunges');
    expect(seen.at(-1)?.transcript).toBe('squats');
    expect(dictation.getState().transcript).toBe('squats and lunges');
  });
});

describe('Dictation — the run ends with the session', () => {
  it('ends the run when the browser closes the session, keeping what was said', async () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('add three sets');

    timeOut();
    expect(dictation.getState()).toMatchObject({
      listening: false,
      transcript: 'add three sets',
      partial: '',
    });

    // Nothing is reopened behind the user's back.
    await settle();
    expect(built).toHaveLength(1);
    expect(newest().live).toBe(false);
  });

  it('keeps the phrase in flight when the session ends under it', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('add three sets');
    newest().speaking('of squats');

    timeOut();
    // Those words were on screen; ending the run must not take them back.
    expect(dictation.getState()).toMatchObject({
      transcript: 'add three sets of squats',
      partial: '',
    });
  });

  it('keeps the phrase in flight when the mic button ends the run', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().speaking('add three sets');
    dictation.stop();

    expect(dictation.getState()).toMatchObject({
      transcript: 'add three sets',
      partial: '',
      listening: false,
    });
  });

  it('ends the run quietly when the browser gives up waiting for speech', async () => {
    const onFailure = vi.fn();
    const dictation = makeDictation(onFailure);
    dictation.start();
    newest().said('add squats');
    newest().fail('no-speech');
    timeOut();
    await settle();

    expect(onFailure).not.toHaveBeenCalled();
    expect(dictation.getState()).toMatchObject({ listening: false, transcript: 'add squats' });
  });

  it('takes a second tap to dictate again, and starts that run empty', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('add squats');
    timeOut();

    dictation.start();
    expect(built).toHaveLength(2);
    expect(dictation.getState()).toMatchObject({ listening: true, transcript: '' });
    newest().said('and lunges');
    expect(dictation.getState().transcript).toBe('and lunges');
  });

  it('ignores a session still talking after the run moved on', () => {
    const dictation = makeDictation();
    dictation.start();
    const first = newest();
    first.said('add three sets');
    timeOut();

    dictation.start();
    // A recognizer on its way out reporting into the run that replaced it is
    // the one thing that could double a word.
    first.saidLate('add three sets');
    newest().said('of squats');

    expect(dictation.getState().transcript).toBe('of squats');
  });
});

describe('Dictation — banking what was said', () => {
  it('clears the transcript on reset without ending the run', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('add three sets');
    dictation.reset();

    expect(dictation.getState()).toMatchObject({ transcript: '', listening: true });

    // The browser goes on replaying the phrase that was banked; only what comes
    // after it may land.
    newest().said('of squats');
    expect(dictation.getState().transcript).toBe('of squats');
  });

  it('banks the phrase still in flight, so finalizing it adds nothing back', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().speaking('add three sets');
    // The caller has that interim text on screen and banks it as it stands.
    dictation.reset();
    expect(dictation.getState().partial).toBe('');

    newest().said('add three sets');
    expect(dictation.getState()).toMatchObject({ transcript: '', partial: '' });

    newest().speaking('of squats');
    expect(dictation.getState().partial).toBe('of squats');
  });

  it('stops previewing a banked phrase that is still being refined', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().speaking('add three');
    dictation.reset();

    newest().speaking('add three sets');
    expect(dictation.getState().partial).toBe('');
  });

  it('keeps banked words out of what the run hands over at the end', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('add three sets');
    dictation.reset();
    newest().said('of squats');
    timeOut();

    expect(dictation.getState().transcript).toBe('of squats');
  });

  it('keeps the transcript after stopping so the caller can bank it', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('add three sets');
    dictation.stop();

    expect(dictation.getState()).toMatchObject({
      transcript: 'add three sets',
      partial: '',
      listening: false,
    });
  });

  it('starts a new run empty, whatever the last one heard', () => {
    const dictation = makeDictation();
    dictation.start();
    newest().said('add three sets');
    dictation.stop();

    dictation.start();
    expect(dictation.getState().transcript).toBe('');
    newest().said('add three sets');
    // The same words said again are a new sentence, not a repeat of the old one.
    expect(dictation.getState().transcript).toBe('add three sets');
  });
});

describe('Dictation — ending a run', () => {
  it('stays stopped after stop, even though closing fires the browser end event', async () => {
    const dictation = makeDictation();
    dictation.start();
    dictation.stop();
    await settle();

    expect(dictation.getState().listening).toBe(false);
    expect(built).toHaveLength(1);
    expect(newest().live).toBe(false);
  });

  it('says so when a session dies on the spot without ever listening', () => {
    const onFailure = vi.fn();
    const dictation = makeDictation(onFailure);
    dictation.start();
    // No clock movement: the session ended the instant it opened.
    newest().timeOut();

    expect(onFailure).toHaveBeenCalledWith({ reason: 'no-start' });
    expect(dictation.getState().listening).toBe(false);
  });

  it('does not call a silence that lasted a while a failure to start', () => {
    const onFailure = vi.fn();
    const dictation = makeDictation(onFailure);
    dictation.start();
    timeOut();

    expect(onFailure).not.toHaveBeenCalled();
    expect(dictation.getState().listening).toBe(false);
  });

  it('releases the microphone on dispose', async () => {
    const dictation = makeDictation();
    dictation.start();
    const recognizer = newest();
    dictation.dispose();
    await settle();

    expect(recognizer.live).toBe(false);
    expect(built).toHaveLength(1);
  });

  it('toggles between running and stopped', () => {
    const dictation = makeDictation();
    dictation.toggle();
    expect(dictation.getState().listening).toBe(true);
    dictation.toggle();
    expect(dictation.getState().listening).toBe(false);
  });

  it('ignores a second start while already running', () => {
    const dictation = makeDictation();
    dictation.start();
    dictation.start();
    expect(built).toHaveLength(1);
  });
});

describe('Dictation — failures', () => {
  it('stops for good on a denied microphone instead of reopening into it', async () => {
    const onFailure = vi.fn();
    const dictation = makeDictation(onFailure);
    dictation.start();
    newest().fail('not-allowed');
    await settle();

    expect(onFailure).toHaveBeenCalledWith({ reason: 'denied', code: 'not-allowed' });
    expect(dictation.getState().listening).toBe(false);
    expect(built).toHaveLength(1);
  });

  it('reports a missing microphone', async () => {
    const onFailure = vi.fn();
    const dictation = makeDictation(onFailure);
    dictation.start();
    newest().fail('audio-capture');
    await settle();

    expect(onFailure).toHaveBeenCalledWith({ reason: 'no-microphone', code: 'audio-capture' });
  });

  it('passes an unfamiliar error through with its code, keeping what was said', async () => {
    const onFailure = vi.fn();
    const dictation = makeDictation(onFailure);
    dictation.start();
    newest().said('add three sets');
    newest().fail('network');
    await settle();

    expect(onFailure).toHaveBeenCalledWith({ reason: 'recognizer-error', code: 'network' });
    expect(dictation.getState()).toMatchObject({
      listening: false,
      transcript: 'add three sets',
    });
  });

  it('reports a browser with no recognizer at all instead of doing nothing', () => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    const onFailure = vi.fn();
    const dictation = makeDictation(onFailure);
    dictation.start();

    expect(onFailure).toHaveBeenCalledWith({ reason: 'recognizer-error', code: 'unsupported' });
    expect(dictation.getState().listening).toBe(false);
  });

  it('survives a recognizer that throws instead of starting', () => {
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = function () {
      const recognizer = new FakeRecognizer();
      recognizer.start = () => {
        throw new Error('InvalidStateError');
      };
      built.push(recognizer);
      return recognizer;
    };
    const onFailure = vi.fn();
    const dictation = makeDictation(onFailure);

    expect(() => dictation.start()).not.toThrow();
    expect(onFailure).toHaveBeenCalledWith({ reason: 'no-start' });
    expect(dictation.getState().listening).toBe(false);
  });
});
