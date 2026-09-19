/**
 * Identity for the row a localStorage draft was taken from, so a builder can
 * tell on reopen whether that row is still the one it is about to draw the
 * draft over. Keys are sorted and undefined-valued ones dropped so the same
 * template or program read back from Supabase, built in the app or handed
 * over by the coach fingerprints the same however its fields happen to be
 * ordered or which optional ones are simply absent.
 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .filter(key => record[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 32-bit FNV-1a of `stableStringify(value)`, as eight hex digits. */
export function fingerprint(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
