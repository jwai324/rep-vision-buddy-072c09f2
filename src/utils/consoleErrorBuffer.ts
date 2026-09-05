/**
 * Ring buffer of the most recent runtime errors. Every in-app error report
 * attaches a copy, so the triage routine sees what the console saw at the
 * moment the user hit "Report" — a stack trace from ten seconds earlier is
 * usually the whole diagnosis.
 *
 * Installed once from main.tsx. `console.error` is wrapped rather than
 * replaced: the original still runs, so devtools output is unchanged.
 */
export type RecordedErrorSource =
  | 'console.error'
  | 'window.error'
  | 'unhandledrejection';

export type RecordedError = {
  at: string;
  source: RecordedErrorSource;
  message: string;
  stack?: string;
};

const MAX_ENTRIES = 20;
const MAX_MESSAGE_CHARS = 600;
const MAX_STACK_CHARS = 1500;

const entries: RecordedError[] = [];
let installed = false;

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) {
    return { message: `${value.name}: ${value.message}`, stack: value.stack };
  }
  if (typeof value === 'string') return { message: value };
  try {
    return { message: JSON.stringify(value) ?? String(value) };
  } catch {
    return { message: String(value) };
  }
}

export function recordError(source: RecordedErrorSource, ...args: unknown[]): void {
  const parts = args.map(describe);
  const message = parts.map(p => p.message).join(' ').slice(0, MAX_MESSAGE_CHARS);
  const stack = parts.find(p => p.stack)?.stack?.slice(0, MAX_STACK_CHARS);
  entries.push({ at: new Date().toISOString(), source, message, ...(stack ? { stack } : {}) });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export function getRecentErrors(): RecordedError[] {
  return entries.slice();
}

export function clearRecentErrors(): void {
  entries.length = 0;
}

export function installErrorCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    recordError('console.error', ...args);
  };

  window.addEventListener('error', event => {
    recordError('window.error', event.error ?? event.message);
  });
  window.addEventListener('unhandledrejection', event => {
    recordError('unhandledrejection', event.reason);
  });
}
