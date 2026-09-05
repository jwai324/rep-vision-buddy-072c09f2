import type { SpeechRecognitionLike, SpeechResultEvent } from '@/utils/speechToText';

interface Entry {
  text: string;
  final: boolean;
  confidence: number;
}

/**
 * Stand-in for the browser recognizer. It keeps one cumulative result list per
 * session and hands the *whole* list back on every report, the way Chrome
 * does, so redelivery is the normal case in every test rather than a special
 * one. The browser-specific ways of listing a phrase twice are separate
 * methods so a test can say which pathology it is exercising.
 *
 * Events are delivered synchronously and only when a test asks for them —
 * `abort()` and `stop()` record the call and deliver nothing, so a test
 * decides what the browser does next.
 */
export class FakeSpeechRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: SpeechRecognitionLike['onstart'] = null;
  onend: SpeechRecognitionLike['onend'] = null;
  onerror: SpeechRecognitionLike['onerror'] = null;
  onresult: SpeechRecognitionLike['onresult'] = null;

  /** `start()` has been called and neither `stop()` nor `abort()` since. */
  live = false;
  aborted = false;
  /** `stop()` was called: the browser is expected to finalize and end. */
  stopping = false;
  startCalls = 0;

  private results: Entry[] = [];
  /** The handler as it stood when the session opened — see `lateReport`. */
  private capturedOnResult: SpeechRecognitionLike['onresult'] = null;

  start(): void {
    this.startCalls += 1;
    this.live = true;
    this.capturedOnResult = this.onresult;
    this.onstart?.(new Event('start'));
  }

  stop(): void {
    this.live = false;
    this.stopping = true;
  }

  abort(): void {
    this.live = false;
    this.aborted = true;
  }

  /** The phrase in flight, refined as the speaker goes on. */
  interim(text: string): void {
    this.write(text, false);
  }

  /** That phrase finalized. */
  final(text: string, confidence = 0.9): void {
    this.write(text, true, confidence);
  }

  /** Report the list again with nothing new in it. */
  replay(): void {
    this.report();
  }

  /** The browser ending the session on its own (utterance over, silence). */
  end(): void {
    this.live = false;
    this.onend?.(new Event('end'));
  }

  error(code: string): void {
    this.onerror?.({ error: code });
  }

  /**
   * Chrome for Android: the final result listed a second time at a new index,
   * with zero confidence.
   */
  duplicateFinal(): void {
    const last = this.results[this.results.length - 1];
    if (!last) return;
    this.results.push({ text: last.text, final: true, confidence: 0 });
    this.report();
  }

  /**
   * A cumulative recognizer: a new entry that repeats everything before it
   * and carries on.
   */
  cumulative(text: string, final = false): void {
    const sofar = this.results[this.results.length - 1]?.text ?? '';
    this.results.push({ text: sofar ? `${sofar} ${text}` : text, final, confidence: final ? 0.9 : 0 });
    this.report();
  }

  /** The result list starting over at index 0 with a new phrase. */
  restartList(text: string, final = false): void {
    this.results = [{ text, final, confidence: final ? 0.9 : 0 }];
    this.report();
  }

  /** An earlier entry rewritten by the browser, delivered as a replay. */
  revise(index: number, text: string): void {
    if (this.results[index]) this.results[index] = { ...this.results[index], text };
    this.report();
  }

  /** A report reaching the handler that was live when the session opened. */
  lateReport(text: string): void {
    this.results.push({ text, final: true, confidence: 0.9 });
    this.report(this.capturedOnResult);
  }

  /** The list as the browser would hand it over right now. */
  snapshot(): SpeechResultEvent {
    const results = this.results.map(entry => ({
      0: { transcript: entry.text, confidence: entry.confidence },
      length: 1,
      isFinal: entry.final,
    }));
    return { results: Object.assign(results, { length: results.length }) as never };
  }

  private write(text: string, final: boolean, confidence = 0): void {
    const open = this.results.length - 1;
    if (open >= 0 && !this.results[open].final) this.results[open] = { text, final, confidence };
    else this.results.push({ text, final, confidence });
    this.report();
  }

  private report(handler = this.onresult): void {
    handler?.(this.snapshot());
  }
}

/** Install the fake as the page's recognizer; returns every instance built. */
export function installFakeSpeechRecognition(
  name: 'SpeechRecognition' | 'webkitSpeechRecognition' = 'SpeechRecognition',
): FakeSpeechRecognition[] {
  const built: FakeSpeechRecognition[] = [];
  (window as unknown as Record<string, unknown>)[name] = function () {
    const recognizer = new FakeSpeechRecognition();
    built.push(recognizer);
    return recognizer;
  };
  return built;
}

export function uninstallFakeSpeechRecognition(): void {
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
}
