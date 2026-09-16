import { useSyncExternalStore } from 'react';

/**
 * Exercise demonstration clips: which encoded variant the app serves.
 *
 * Every clip exists twice in the `exercise-clips` bucket (scripts/clips/README.md):
 *
 *   <slug>-<hash>.webm   VP9 with an alpha channel, transparent background
 *   <slug>-<hash>.mp4    H.264, figure flattened onto white
 *
 * CLIP_MODE picks one, explicitly. The two are never offered to the browser as
 * alternative <source> elements: a browser can decode VP9 and still ignore the
 * alpha channel, which renders an opaque black box and raises no error to fall
 * back on.
 *
 *   'opaque'  the .mp4 on an explicit white card. Renders correctly everywhere,
 *             and the baked white background reads as an intentional card.
 *   'alpha'   the .webm over a transparent container that follows the theme.
 *             Switch to this only once alpha has been verified on the target
 *             WebView; whether iOS WKWebView honours VP9 alpha is untested.
 */
export type ClipMode = 'opaque' | 'alpha';

export const CLIP_MODE: ClipMode = 'opaque';

export const CLIP_BUCKET = 'exercise-clips';

/**
 * Dev-only override, so both modes can be tried on a phone from one build:
 * `?clipmode=alpha` or `?clipmode=opaque` on the page URL, or the toggle under
 * Settings → Developer. The value is persisted so it survives the in-app
 * navigation that drops the query string; `?clipmode=reset` clears it. The
 * URL is read once, when the page loads.
 *
 * Vite folds import.meta.env.DEV to a literal, so a production build compiles
 * the override out: resolveClipMode() runs with enabled=false and neither the
 * URL nor localStorage is consulted. A dev build (`npm run dev`, or
 * `npm run build:dev` for a Capacitor test build) has it.
 */
export const CLIP_MODE_OVERRIDE_ENABLED: boolean = import.meta.env.DEV;
export const CLIP_MODE_URL_PARAM = 'clipmode';
export const CLIP_MODE_STORAGE_KEY = 'repvision.clipmode';

type OverrideStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function parseClipMode(value: unknown): ClipMode | null {
  return value === 'opaque' || value === 'alpha' ? value : null;
}

/**
 * Pure resolution: the URL parameter first (and persisted), then the persisted
 * value, then CLIP_MODE. With `enabled` false the answer is CLIP_MODE, always.
 */
export function resolveClipMode(input: {
  enabled: boolean;
  search: string;
  storage: OverrideStorage | null;
}): ClipMode {
  if (!input.enabled) return CLIP_MODE;
  const param = new URLSearchParams(input.search).get(CLIP_MODE_URL_PARAM);
  if (param === 'reset') {
    safely(() => input.storage?.removeItem(CLIP_MODE_STORAGE_KEY));
    return CLIP_MODE;
  }
  const fromUrl = parseClipMode(param);
  if (fromUrl) {
    safely(() => input.storage?.setItem(CLIP_MODE_STORAGE_KEY, fromUrl));
    return fromUrl;
  }
  return parseClipMode(safely(() => input.storage?.getItem(CLIP_MODE_STORAGE_KEY))) ?? CLIP_MODE;
}

// localStorage throws in some private-browsing and WebView configurations.
function safely<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function browserStorage(): OverrideStorage | null {
  return safely(() => (typeof window === 'undefined' ? null : window.localStorage));
}

// A small external store, so every mounted clip re-renders when the override changes.
let resolved: ClipMode | null = null;
const listeners = new Set<() => void>();

export function getClipMode(): ClipMode {
  if (resolved === null) {
    resolved = resolveClipMode({
      enabled: CLIP_MODE_OVERRIDE_ENABLED,
      search: typeof window === 'undefined' ? '' : window.location.search,
      storage: browserStorage(),
    });
  }
  return resolved;
}

/** The persisted dev override, or null when the app is on CLIP_MODE. */
export function getClipModeOverride(): ClipMode | null {
  if (!CLIP_MODE_OVERRIDE_ENABLED) return null;
  return parseClipMode(safely(() => browserStorage()?.getItem(CLIP_MODE_STORAGE_KEY)));
}

/**
 * Dev-only. Sets the override (null clears it) and notifies subscribers. A
 * no-op when the override is compiled out.
 */
export function setClipModeOverride(mode: ClipMode | null): void {
  if (!CLIP_MODE_OVERRIDE_ENABLED) return;
  const storage = browserStorage();
  safely(() => (mode ? storage?.setItem(CLIP_MODE_STORAGE_KEY, mode) : storage?.removeItem(CLIP_MODE_STORAGE_KEY)));
  resolved = mode ?? CLIP_MODE;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useClipMode(): ClipMode {
  return useSyncExternalStore(subscribe, getClipMode, () => CLIP_MODE);
}
