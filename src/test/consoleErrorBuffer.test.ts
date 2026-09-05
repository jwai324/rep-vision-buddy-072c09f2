import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordError,
  getRecentErrors,
  clearRecentErrors,
  installErrorCapture,
} from '@/utils/consoleErrorBuffer';

describe('consoleErrorBuffer', () => {
  beforeEach(() => clearRecentErrors());

  it('keeps only the most recent 20 entries', () => {
    for (let i = 0; i < 25; i++) recordError('console.error', `error ${i}`);
    const entries = getRecentErrors();
    expect(entries).toHaveLength(20);
    expect(entries[0].message).toBe('error 5');
    expect(entries[19].message).toBe('error 24');
  });

  it('records an Error with its stack and truncates long messages', () => {
    const err = new Error('boom');
    recordError('unhandledrejection', err);
    const [entry] = getRecentErrors();
    expect(entry.source).toBe('unhandledrejection');
    expect(entry.message).toBe('Error: boom');
    expect(entry.stack).toContain('boom');

    clearRecentErrors();
    recordError('console.error', 'x'.repeat(2000));
    expect(getRecentErrors()[0].message).toHaveLength(600);
  });

  it('serialises non-string arguments and survives circular ones', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    recordError('console.error', 'ctx', { code: 42 }, circular);
    expect(getRecentErrors()[0].message).toBe('ctx {"code":42} [object Object]');
  });

  it('captures console.error calls and window error events once installed', () => {
    installErrorCapture();
    installErrorCapture(); // idempotent — a second install must not double-record

    console.error('[useShares] fetch error:', new Error('network'));
    window.dispatchEvent(new ErrorEvent('error', { message: 'script blew up', error: new Error('script blew up') }));

    const entries = getRecentErrors();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ source: 'console.error', message: '[useShares] fetch error: Error: network' });
    expect(entries[1]).toMatchObject({ source: 'window.error', message: 'Error: script blew up' });
  });
});
