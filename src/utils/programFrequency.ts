import type { DayFrequency, ProgramDay } from '@/types/workout';

/**
 * Frequency values arrive from four places that do not agree on validation:
 * the builder, the coach's create_program tool, a shared program and a
 * restored backup. The last two carry whatever was in the file. An
 * `everyNDays` interval of 0 sends the scheduler into an infinite loop (a
 * denial of service by share link), and a `monthly` day of 29–31 used to
 * overflow into the next month and drift the whole schedule permanently.
 * Every reader goes through here.
 */
export function sanitizeFrequency(f: unknown): DayFrequency | undefined {
  if (!f || typeof f !== 'object') return undefined;
  const v = f as Record<string, unknown>;
  switch (v.type) {
    case 'weekly': {
      const weekday = Number(v.weekday);
      return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? { type: 'weekly', weekday } : undefined;
    }
    case 'monthly': {
      const dayOfMonth = Number(v.dayOfMonth);
      return Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31 ? { type: 'monthly', dayOfMonth } : undefined;
    }
    case 'everyNDays': {
      const interval = Number(v.interval);
      if (!Number.isInteger(interval) || interval < 1 || interval > 366) return undefined;
      const startDate = typeof v.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.startDate) ? v.startDate : undefined;
      return startDate ? { type: 'everyNDays', interval, startDate } : { type: 'everyNDays', interval };
    }
    default:
      return undefined;
  }
}

/** A program's days with every frequency validated; an invalid one becomes unscheduled rather than dangerous. */
export function sanitizeProgramDays(days: ProgramDay[]): ProgramDay[] {
  return days.map(day => {
    const frequency = sanitizeFrequency(day.frequency);
    if (frequency) return { ...day, frequency };
    const { frequency: _dropped, ...rest } = day;
    void _dropped;
    return rest;
  });
}

const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/**
 * Every occurrence of "the Nth of each month" in [start, end), clamped to the
 * month's length — the 31st falls on the 30th in a 30-day month and on the
 * 28th/29th in February. Walking a (year, month) cursor is what keeps it from
 * overflowing: `setDate(31)` on a 30-day month is the 1st of the next month,
 * and every later `setMonth(+1)` then carries the slip forward.
 */
export function monthlyOccurrences(start: Date, end: Date, dayOfMonth: number): Date[] {
  const out: Date[] = [];
  if (!(dayOfMonth >= 1 && dayOfMonth <= 31)) return out;
  let year = start.getFullYear();
  let month = start.getMonth();
  for (let guard = 0; guard < 240; guard++) {
    const day = Math.min(dayOfMonth, daysInMonth(year, month));
    const occurrence = new Date(year, month, day);
    if (occurrence >= end) break;
    if (occurrence >= start) out.push(occurrence);
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return out;
}
