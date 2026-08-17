/**
 * Validate a `?next=` redirect target.
 *
 * Only same-origin absolute paths are allowed. `//evil.com` is a
 * protocol-relative URL that browsers treat as another host, so it has to be
 * rejected alongside anything carrying a scheme — otherwise the share page's
 * "sign in to save" link becomes an open redirect.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;
  if (value.includes('\\')) return null;
  return value;
}
