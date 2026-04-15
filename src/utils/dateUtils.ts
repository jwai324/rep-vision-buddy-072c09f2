/**
 * Safely parse a date string into a local-time Date object.
 * Handles both "yyyy-MM-dd" and full ISO timestamps like "2026-04-15T12:00:00Z".
 * Always returns a Date at local midnight for the given calendar date.
 */
export function parseLocalDate(dateStr: string): Date {
  if (!dateStr) return new Date(NaN);
  // If it's a plain yyyy-MM-dd (10 chars), append T00:00:00 for local parsing
  const dayPart = dateStr.length === 10 ? dateStr : dateStr.substring(0, 10);
  return new Date(dayPart + 'T00:00:00');
}
