import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

interface Options<S> {
  /** The screen the browser's history bottoms out on; Back from it leaves the site. */
  isRoot: (screen: S) => boolean;
  /** Called with the screen being left when the USER presses Back (never for in-app navigation). */
  onUserBack?: (leaving: S) => void;
}

/**
 * Screen state that the browser's Back button understands.
 *
 * Every screen used to live in a plain useState with no history entry, so on
 * Android — where Back is muscle memory — one press left the site instead of
 * going back a screen. Each change of screen *type* now pushes one history
 * entry, and popstate restores the screen beneath it. Two navigations are
 * mapped onto the browser's own history rather than pushed: going home
 * unwinds to the root entry (so Back at home still exits, instead of
 * replaying the whole trip), and an in-app "back" to the screen directly
 * beneath goes back one entry. Same-type updates (a detail screen swapping
 * its payload) change state in place and add nothing.
 *
 * Deep links and reload survival are deliberately out of scope: a reload
 * starts at the root with an empty stack, and stale entries left in the tab's
 * history simply pop back to the root.
 */
export function useScreenHistory<S extends { type: string }>(initial: S, options: Options<S>) {
  const [screen, setScreenState] = useState<S>(initial);
  const current = useRef<S>(initial);
  const beneath = useRef<S[]>([]);
  // Set when we asked the browser to move (go/back); the popstate that follows
  // is ours, not the user's, and this is the screen it should land on.
  const programmatic = useRef<{ screen: S; unwind: boolean } | null>(null);
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    try { window.history.replaceState({ screenDepth: 0 }, ''); } catch { /* sandboxed */ }
    const onPop = () => {
      const pending = programmatic.current;
      if (pending) {
        programmatic.current = null;
        if (pending.unwind) beneath.current = [];
        else beneath.current.pop();
        current.current = pending.screen;
        setScreenState(pending.screen);
        return;
      }
      opts.current.onUserBack?.(current.current);
      const prev = beneath.current.pop() ?? initial;
      current.current = prev;
      setScreenState(prev);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // `initial` is the root and never changes identity in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setScreen = useCallback((next: SetStateAction<S>) => {
    const from = current.current;
    const to = typeof next === 'function' ? (next as (prev: S) => S)(from) : next;
    if (to === from) return;

    if (to.type === from.type) {
      current.current = to;
      setScreenState(to);
      return;
    }

    const depth = beneath.current.length;
    if (opts.current.isRoot(to) && depth > 0) {
      programmatic.current = { screen: to, unwind: true };
      window.history.go(-depth);
      return;
    }

    const top = beneath.current[depth - 1];
    if (top && top.type === to.type) {
      programmatic.current = { screen: to, unwind: false };
      window.history.back();
      return;
    }

    beneath.current.push(from);
    try { window.history.pushState({ screenDepth: beneath.current.length }, ''); } catch { /* sandboxed */ }
    current.current = to;
    setScreenState(to);
  }, []);

  return [screen, setScreen] as const;
}
