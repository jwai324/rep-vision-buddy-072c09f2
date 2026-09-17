import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveClipMode, CLIP_MODE, CLIP_MODE_STORAGE_KEY } from '@/config/exerciseClips';

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe('resolveClipMode', () => {
  it('is CLIP_MODE when the override is compiled out, whatever the URL or storage say', () => {
    const storage = memoryStorage({ [CLIP_MODE_STORAGE_KEY]: 'alpha' });
    expect(resolveClipMode({ enabled: false, search: '?clipmode=alpha', storage })).toBe(CLIP_MODE);
    expect(storage.map.get(CLIP_MODE_STORAGE_KEY)).toBe('alpha');
  });

  it('takes the URL parameter and persists it', () => {
    const storage = memoryStorage();
    expect(resolveClipMode({ enabled: true, search: '?foo=1&clipmode=alpha', storage })).toBe('alpha');
    expect(storage.map.get(CLIP_MODE_STORAGE_KEY)).toBe('alpha');
  });

  it('falls back to the persisted value, then to CLIP_MODE', () => {
    expect(resolveClipMode({ enabled: true, search: '', storage: memoryStorage({ [CLIP_MODE_STORAGE_KEY]: 'alpha' }) })).toBe('alpha');
    expect(resolveClipMode({ enabled: true, search: '', storage: memoryStorage() })).toBe(CLIP_MODE);
    expect(resolveClipMode({ enabled: true, search: '', storage: null })).toBe(CLIP_MODE);
  });

  it('ignores values that are not a mode', () => {
    const storage = memoryStorage({ [CLIP_MODE_STORAGE_KEY]: 'sepia' });
    expect(resolveClipMode({ enabled: true, search: '?clipmode=transparent', storage })).toBe(CLIP_MODE);
  });

  it('?clipmode=reset clears the persisted override', () => {
    const storage = memoryStorage({ [CLIP_MODE_STORAGE_KEY]: 'alpha' });
    expect(resolveClipMode({ enabled: true, search: '?clipmode=reset', storage })).toBe(CLIP_MODE);
    expect(storage.map.has(CLIP_MODE_STORAGE_KEY)).toBe(false);
  });

  it('survives a storage that throws', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(resolveClipMode({ enabled: true, search: '?clipmode=alpha', storage: throwing })).toBe('alpha');
    expect(resolveClipMode({ enabled: true, search: '', storage: throwing })).toBe(CLIP_MODE);
  });
});

describe('clip mode store', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('is compiled in under a dev build and re-renders subscribers when the override changes', async () => {
    const mod = await import('@/config/exerciseClips');
    const { renderHook, act } = await import('@testing-library/react');
    expect(mod.CLIP_MODE_OVERRIDE_ENABLED).toBe(true);

    const { result } = renderHook(() => mod.useClipMode());
    expect(result.current).toBe('opaque');

    act(() => mod.setClipModeOverride('alpha'));
    expect(result.current).toBe('alpha');
    expect(mod.getClipModeOverride()).toBe('alpha');
    expect(localStorage.getItem(mod.CLIP_MODE_STORAGE_KEY)).toBe('alpha');

    act(() => mod.setClipModeOverride(null));
    expect(result.current).toBe('opaque');
    expect(mod.getClipModeOverride()).toBeNull();
    expect(localStorage.getItem(mod.CLIP_MODE_STORAGE_KEY)).toBeNull();
  });

  it('reads ?clipmode= from the page URL when first resolved', async () => {
    window.history.replaceState(null, '', '/?clipmode=alpha');
    const mod = await import('@/config/exerciseClips');
    expect(mod.getClipMode()).toBe('alpha');
    expect(localStorage.getItem(mod.CLIP_MODE_STORAGE_KEY)).toBe('alpha');
  });

  it('is inert in a production build: URL, storage and the setter all leave CLIP_MODE alone', async () => {
    vi.stubEnv('DEV', false);
    window.history.replaceState(null, '', '/?clipmode=alpha');
    localStorage.setItem(CLIP_MODE_STORAGE_KEY, 'alpha');
    const mod = await import('@/config/exerciseClips');
    expect(mod.CLIP_MODE_OVERRIDE_ENABLED).toBe(false);
    expect(mod.getClipMode()).toBe(CLIP_MODE);
    expect(mod.getClipModeOverride()).toBeNull();
    mod.setClipModeOverride('alpha');
    expect(mod.getClipMode()).toBe(CLIP_MODE);
  });
});
