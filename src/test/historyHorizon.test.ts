import { describe, it, expect } from 'vitest';
import { historyHorizonDays } from '@/utils/historyAnalysis';

const NOW = new Date(2026, 4, 15, 12, 0, 0).getTime(); // local noon, 2026-05-15

function daysAgoStr(n: number): string {
  const d = new Date(NOW - n * 24 * 60 * 60 * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('historyHorizonDays', () => {
  it('uses the earlier anchor when data predates a young account', () => {
    expect(historyHorizonDays(daysAgoStr(3), daysAgoStr(30), NOW)).toBe(30);
  });

  it('caps at one year even when both anchors are older', () => {
    expect(historyHorizonDays(daysAgoStr(400), daysAgoStr(500), NOW)).toBe(365);
  });

  it('falls back to account age when there are no sessions', () => {
    expect(historyHorizonDays(daysAgoStr(10), null, NOW)).toBe(10);
  });

  it('falls back to 365 when neither anchor is known', () => {
    expect(historyHorizonDays(null, null, NOW)).toBe(365);
  });

  it('keeps the sign-up anchor when it is older than the first workout', () => {
    expect(historyHorizonDays(daysAgoStr(30), daysAgoStr(5), NOW)).toBe(30);
  });

  it('works from session data alone (full ISO timestamp accepted)', () => {
    expect(historyHorizonDays(null, daysAgoStr(45), NOW)).toBe(45);
  });
});
