import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenHistory } from '@/hooks/useScreenHistory';

type S =
  | { type: 'dashboard' }
  | { type: 'templates' }
  | { type: 'builder'; id?: string }
  | { type: 'activity' }
  | { type: 'detail'; id: string; v?: number }
  | { type: 'credits' }
  | { type: 'activeSession'; resumed?: boolean };
const ROOT: S = { type: 'dashboard' };

/** jsdom delivers popstate for history.back()/go() on a later task (~20ms); give it room. */
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 60)); });

describe('useScreenHistory', () => {
  beforeEach(() => {
    // Each test starts on its own history so depth from a previous one cannot leak.
    window.history.replaceState(null, '', '/');
  });

  it('pushes one history entry per change of screen type', () => {
    const before = window.history.length;
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard' }));

    act(() => result.current[1]({ type: 'templates' }));
    act(() => result.current[1]({ type: 'builder' }));

    expect(result.current[0].type).toBe('builder');
    expect(window.history.length).toBe(before + 2);
  });

  it('does not add an entry for an in-place update of the same screen', () => {
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard' }));
    act(() => result.current[1]({ type: 'builder', id: 'a' }));
    const len = window.history.length;

    act(() => result.current[1]({ type: 'builder', id: 'b' }));

    expect(result.current[0]).toEqual({ type: 'builder', id: 'b' });
    expect(window.history.length).toBe(len);
  });

  it('restores the previous screen when the user presses Back', async () => {
    const onUserBack = vi.fn();
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard', onUserBack }));
    act(() => result.current[1]({ type: 'templates' }));
    act(() => result.current[1]({ type: 'builder' }));

    act(() => window.history.back());
    await settle();

    expect(result.current[0].type).toBe('templates');
    expect(onUserBack).toHaveBeenCalledWith({ type: 'builder' });
  });

  it('tells the caller which screen was left, so a live workout can be minimized rather than lost', async () => {
    const onUserBack = vi.fn();
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard', onUserBack }));
    act(() => result.current[1]({ type: 'activeSession' }));

    act(() => window.history.back());
    await settle();

    expect(onUserBack).toHaveBeenCalledWith({ type: 'activeSession' });
    expect(result.current[0].type).toBe('dashboard');
  });

  it('unwinds to the root when the app navigates home, so Back at home still leaves', async () => {
    const onUserBack = vi.fn();
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard', onUserBack }));
    act(() => result.current[1]({ type: 'templates' }));
    act(() => result.current[1]({ type: 'builder' }));
    const depthBefore = window.history.length;

    act(() => result.current[1]({ type: 'dashboard' }));
    await settle();

    expect(result.current[0].type).toBe('dashboard');
    // In-app navigation is not a user Back: nothing was "left" by the user.
    expect(onUserBack).not.toHaveBeenCalled();
    // Two entries unwound, none pushed.
    expect(window.history.length).toBe(depthBefore);
    // And a user Back from here does not replay the trip.
    act(() => window.history.back());
    await settle();
    expect(result.current[0].type).toBe('dashboard');
  });

  it('treats an in-app back to the screen beneath as going back one entry', async () => {
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard' }));
    act(() => result.current[1]({ type: 'templates' }));
    act(() => result.current[1]({ type: 'builder' }));
    const len = window.history.length;

    act(() => result.current[1]({ type: 'templates' }));
    await settle();

    expect(result.current[0].type).toBe('templates');
    expect(window.history.length).toBe(len);
  });

  it('unwinds to a screen already in the stack instead of pushing, so a saved editor is not replayed by Back', async () => {
    // dashboard → activity → detail → builder, then "save, back to the list".
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard' }));
    act(() => result.current[1]({ type: 'activity' }));
    act(() => result.current[1]({ type: 'detail', id: 'a' }));
    act(() => result.current[1]({ type: 'builder', id: 'a' }));
    const len = window.history.length;

    act(() => result.current[1]({ type: 'activity' }));
    // The screen changes at once; the browser catches up on its own task.
    expect(result.current[0].type).toBe('activity');
    await settle();
    expect(window.history.length).toBe(len);

    // Back from the list is the dashboard, not the editor or the detail.
    act(() => window.history.back());
    await settle();
    expect(result.current[0].type).toBe('dashboard');
  });

  it('changes the screen synchronously when it unwinds, so nothing runs against a screen on its way out', () => {
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard' }));
    act(() => result.current[1]({ type: 'activeSession' }));
    act(() => result.current[1]({ type: 'dashboard' }));
    expect(result.current[0].type).toBe('dashboard');
  });

  it('hands a restored screen through `restore`, so a stale payload is refreshed and a dead one skipped', async () => {
    const restore = vi.fn((s: S): S | null => {
      if (s.type === 'detail') return s.id === 'gone' ? null : { ...s, v: 2 };
      if (s.type === 'activeSession') return { ...s, resumed: true };
      return s;
    });
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard', restore }));
    act(() => result.current[1]({ type: 'activeSession' }));
    act(() => result.current[1]({ type: 'credits' }));

    // A live workout left for the credits screen comes back marked as resumed,
    // so it reads its cache instead of mounting blank over it.
    act(() => window.history.back());
    await settle();
    expect(result.current[0]).toEqual({ type: 'activeSession', resumed: true });

    act(() => result.current[1]({ type: 'dashboard' }));
    await settle();
    act(() => result.current[1]({ type: 'activity' }));
    act(() => result.current[1]({ type: 'detail', id: 'gone' }));
    act(() => result.current[1]({ type: 'builder' }));

    // The detail's row was deleted meanwhile: Back skips it and lands on the list.
    act(() => window.history.back());
    await settle();
    await settle();
    expect(result.current[0].type).toBe('activity');
    // And a further Back is the dashboard — the skipped entry was consumed too.
    act(() => window.history.back());
    await settle();
    expect(result.current[0].type).toBe('dashboard');
  });

  it('lets the app keep the screen on Back by returning true, so Back can close an overlay', async () => {
    let overlayOpen = true;
    const onUserBack = vi.fn(() => {
      if (overlayOpen) { overlayOpen = false; return true; }
      return undefined;
    });
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard', onUserBack }));
    act(() => result.current[1]({ type: 'activeSession' }));
    const len = window.history.length;

    act(() => window.history.back());
    await settle();
    await settle();
    expect(result.current[0].type).toBe('activeSession');
    expect(overlayOpen).toBe(false);
    expect(window.history.length).toBe(len);

    // Second Back, overlay gone: leaves the screen as usual.
    act(() => window.history.back());
    await settle();
    expect(result.current[0].type).toBe('dashboard');
  });

  it('undoes a Forward press, since the screens above were discarded', async () => {
    const onUserBack = vi.fn();
    const { result } = renderHook(() => useScreenHistory<S>(ROOT, { isRoot: s => s.type === 'dashboard', onUserBack }));
    act(() => result.current[1]({ type: 'activity' }));
    act(() => result.current[1]({ type: 'activeSession' }));
    act(() => window.history.back());
    await settle();
    expect(result.current[0].type).toBe('activity');
    onUserBack.mockClear();

    act(() => window.history.forward());
    await settle();
    await settle();
    expect(result.current[0].type).toBe('activity');
    expect(onUserBack).not.toHaveBeenCalled();
    // Still one Back from the dashboard: the stack did not desync.
    act(() => window.history.back());
    await settle();
    expect(result.current[0].type).toBe('dashboard');
  });
});
