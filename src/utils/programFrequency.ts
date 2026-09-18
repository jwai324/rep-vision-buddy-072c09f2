import { addDays, addWeeks, differenceInCalendarDays } from 'date-fns';
import type { DayFrequency, ProgramDay, WorkoutProgram } from '@/types/workout';
import { parseLocalDate } from '@/utils/dateUtils';

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
      // 7 is Sunday in the ISO numbering an older builder wrote; the load-time
      // repair in useStorage maps it the same way, so every door agrees.
      const raw = Number(v.weekday);
      const weekday = raw === 7 ? 0 : raw;
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
const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

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
  // Occurrences are midnights; a `start` carrying a time of day (the builder
  // seeds a new program with `new Date()`) must not exclude today's.
  const from = startOfLocalDay(start);
  let year = from.getFullYear();
  let month = from.getMonth();
  for (let guard = 0; guard < 240; guard++) {
    const day = Math.min(dayOfMonth, daysInMonth(year, month));
    const occurrence = new Date(year, month, day);
    if (occurrence >= end) break;
    if (occurrence >= from) out.push(occurrence);
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return out;
}

/**
 * Every date a frequency lands on in [start, end). The one walker for all of
 * them: the scheduler, the dashboard's week strip, the monthly calendar and
 * the day-tap helper each used to carry their own loops, and three of the four
 * kept the interval-0 hang and the month overflow after the scheduler was
 * fixed. An invalid frequency yields nothing.
 */
export function frequencyOccurrences(frequency: unknown, start: Date, end: Date): Date[] {
  const freq = sanitizeFrequency(frequency);
  if (!freq) return [];
  const from = startOfLocalDay(start);
  const out: Date[] = [];
  if (freq.type === 'weekly') {
    const diff = (freq.weekday - from.getDay() + 7) % 7;
    for (let cur = addDays(from, diff); cur < end; cur = addDays(cur, 7)) out.push(cur);
    return out;
  }
  if (freq.type === 'everyNDays') {
    let cur = freq.startDate ? parseLocalDate(freq.startDate) : from;
    if (cur < from) {
      // Jump to the first occurrence on or after `from` rather than walking
      // years of a long-past origin one interval at a time. Calendar days,
      // not milliseconds, so a DST hour cannot skip an occurrence.
      const behind = differenceInCalendarDays(from, cur);
      cur = addDays(cur, Math.floor(behind / freq.interval) * freq.interval);
      while (cur < from) cur = addDays(cur, freq.interval);
    }
    for (; cur < end; cur = addDays(cur, freq.interval)) out.push(cur);
    return out;
  }
  return monthlyOccurrences(from, end, freq.dayOfMonth);
}

export interface ScheduledOccurrence {
  date: Date;
  label: string;
  templateId: string;
}

/** The window a program's schedule covers: [start of its start date, +durationWeeks). */
export function programWindow(program: Pick<WorkoutProgram, 'startDate' | 'durationWeeks'>): { start: Date; end: Date } {
  const start = startOfLocalDay(program.startDate ? parseLocalDate(program.startDate) : new Date());
  return { start, end: addWeeks(start, program.durationWeeks ?? 8) };
}

/** Every workout a program schedules across its window, in day order. */
export function programOccurrences(program: Pick<WorkoutProgram, 'days' | 'startDate' | 'durationWeeks'>): ScheduledOccurrence[] {
  const { start, end } = programWindow(program);
  const out: ScheduledOccurrence[] = [];
  for (const day of program.days) {
    for (const date of frequencyOccurrences(day.frequency, start, end)) {
      out.push({ date, label: day.label, templateId: day.templateId });
    }
  }
  return out;
}

/** What a program schedules on one date; empty outside its window. */
export function programOccurrencesOn(program: Pick<WorkoutProgram, 'days' | 'startDate' | 'durationWeeks'>, date: Date): Omit<ScheduledOccurrence, 'date'>[] {
  const { start, end } = programWindow(program);
  const day = startOfLocalDay(date);
  if (day < start || day >= end) return [];
  const next = addDays(day, 1);
  const out: Omit<ScheduledOccurrence, 'date'>[] = [];
  for (const d of program.days) {
    if (frequencyOccurrences(d.frequency, day, next).length > 0) out.push({ label: d.label, templateId: d.templateId });
  }
  return out;
}
