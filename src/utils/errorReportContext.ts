import { getRecentErrors, type RecordedError } from './consoleErrorBuffer';

/**
 * Everything the report sheet attaches on the user's behalf. Kept as a plain
 * JSON-shaped type (no interfaces) so it can be handed to the `context` jsonb
 * column without a cast.
 */
export type ReportContext = {
  online: boolean;
  language: string;
  timezone: string;
  displayMode: 'standalone' | 'browser';
  recentErrors: RecordedError[];
  capturedAt: string;
};

// Injected at build time (vite.config.ts) from the commit Vercel is deploying.
// The triage routine compares it against main to tell whether a report
// predates a fix that has already shipped.
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : 'dev';

export function buildReportContext(): ReportContext {
  let timezone = 'unknown';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown';
  } catch {
    // Some embedded webviews throw here; the field is a nicety.
  }
  const standalone =
    typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return {
    online: navigator.onLine,
    language: navigator.language,
    timezone,
    displayMode: standalone ? 'standalone' : 'browser',
    recentErrors: getRecentErrors(),
    capturedAt: new Date().toISOString(),
  };
}
