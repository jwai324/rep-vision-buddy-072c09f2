/**
 * Safely parse a date string into a local-time Date object.
 * Handles both "yyyy-MM-dd" and full ISO timestamps like "2026-04-15T12:00:00Z".
 * Always returns a Date at local midnight for the given calendar date.
 */
export function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  if (dateStr.length === 10) {
    return new Date(dateStr + 'T00:00:00');
  }
  // Full ISO timestamp — parse natively to get local time, then extract local date
  const d = new Date(dateStr);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Format a Date as "yyyy-MM-dd" using LOCAL time components.
 * Never use toISOString().split('T')[0] — that uses UTC and can shift the date by 1 day.
 */
export function formatLocalDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
