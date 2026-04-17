/**
 * Format total seconds as "m:ss" (e.g. 85 -> "1:25").
 */
export function formatMmSs(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00';
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Parse a user-typed time string into total seconds.
 * Accepts:
 *   - "1:25"     -> 85
 *   - "0:45"     -> 45
 *   - "85"       -> 85 (raw seconds)
 *   - "1.5"      -> 90 (legacy decimal minutes)
 *   - ""         -> null
 */
export function parseMmSs(input: string): number | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  if (s.includes(':')) {
    const [mStr, secStr = '0'] = s.split(':');
    const m = parseInt(mStr, 10);
    const sec = parseInt(secStr, 10);
    if (Number.isNaN(m) || Number.isNaN(sec)) return null;
    return Math.max(0, m * 60 + sec);
  }

  // Legacy decimal minutes (e.g. "1.5" => 90s)
  if (s.includes('.')) {
    const min = parseFloat(s);
    if (Number.isNaN(min)) return null;
    return Math.max(0, Math.round(min * 60));
  }

  // Bare integer = seconds
  const n = parseInt(s, 10);
  if (Number.isNaN(n)) return null;
  return Math.max(0, n);
}

/**
 * Interpret a stored `time` value (string or number) as seconds, handling
 * legacy decimal-minute storage. Heuristic: a decimal value <= 60 is treated
 * as minutes; otherwise treated as seconds.
 */
export function timeToSeconds(value: string | number | undefined | null): number {
  if (value == null || value === '') return 0;
  const s = typeof value === 'number' ? String(value) : value;
  const parsed = parseMmSs(s);
  return parsed ?? 0;
}
