import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScreenHistory } from '@/hooks/useScreenHistory';

type S = { type: 'dashboard' } | { type: 'templates' } | { type: 'builder'; id?: string } | { type: 'activeSession' };
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
});
