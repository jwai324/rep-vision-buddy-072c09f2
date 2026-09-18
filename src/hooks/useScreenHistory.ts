import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

interface Options<S> {
  /** The screen the browser's history bottoms out on; Back from it leaves the site. */
  isRoot: (screen: S) => boolean;
  /**
   * Called with the screen being left when the USER presses Back (never for
   * in-app navigation). Return `true` to keep the screen: the hook puts the
   * history entry back, so Back can close an overlay instead of leaving.
   */
  onUserBack?: (leaving: S) => boolean | void;
  /**
   * A screen coming back from history is whatever object was stored when it
   * was left, and the app has moved on since — the session it showed may have
   * been edited or deleted. This maps the stored screen to what should be
   * shown now; `null` means the entry is dead and Back keeps going.
   */
  restore?: (screen: S) => S | null;
}

interface Entry {
  screenDepth: number;
  screenSid: string;
}

/**
 * Screen state that the browser's Back button understands.
 *
 * Every screen used to live in a plain useState with no history entry, so on
 * Android — where Back is muscle memory — one press left the site instead of
 * going back a screen. Each change of screen *type* now pushes one history
 * entry, tagged with its depth, and popstate restores the screen beneath.
 *
 * In-app navigation maps onto the browser's own history wherever it can:
 * going home unwinds to the root entry (so Back at home still exits rather
 * than replaying the trip), and going to a screen type that is already in the
 * stack unwinds to it, so "save, back to the list" never leaves the editor in
 * the history to be replayed. Only a genuinely new screen pushes. Same-type
 * updates (a detail screen swapping its payload) change state in place.
 *
 * State changes synchronously on every navigation. The browser's own move
 * (`history.go`) lands later, on a task of its own, and the popstate it fires
 * is recognised by depth and ignored — the app never waits on it, so nothing
 * runs against a screen that is on its way out. A Forward press is undone
 * (the screens above were discarded), and Back across several entries at once
 * pops them all.
 *
 * Deep links and reload survival are deliberately out of scope: a reload
 * starts at the root with an empty stack, and entries from an earlier page
 * load (recognised by their sid) pop back to the root.
 */
export function useScreenHistory<S extends { type: string }>(initial: S, options: Options<S>) {
  const [screen, setScreenState] = useState<S>(initial);
  const current = useRef<S>(initial);
  const beneath = useRef<S[]>([]);
  // The depth the next popstate should report because we asked for the move.
  const programmatic = useRef<number | null>(null);
  const sid = useRef(Math.random().toString(36).slice(2));
  const opts = useRef(options);
  opts.current = options;

  const entryState = useCallback((depth: number): Entry => ({ screenDepth: depth, screenSid: sid.current }), []);
  const readEntry = useCallback((state: unknown): Entry | null => {
    const e = state as Partial<Entry> | null;
    return e && typeof e.screenDepth === 'number' && e.screenSid === sid.current
      ? { screenDepth: e.screenDepth, screenSid: e.screenSid }
      : null;
  }, []);

  const apply = useCallback((next: S) => {
    current.current = next;
    setScreenState(next);
  }, []);

  // Ask the browser to move; the state was already applied by the caller.
  const move = useCallback((delta: number, toDepth: number) => {
    if (delta === 0) return;
    programmatic.current = toDepth;
    try { window.history.go(delta); } catch { /* sandboxed */ }
  }, []);

  useEffect(() => {
    try { window.history.replaceState(entryState(0), ''); } catch { /* sandboxed */ }

    const onPop = (e: PopStateEvent) => {
      const entry = readEntry(e.state);
      const fromDepth = beneath.current.length;

      if (programmatic.current !== null) {
        const expected = programmatic.current;
        programmatic.current = null;
        if (entry && entry.screenDepth === expected) return;
        // Not the move we asked for (a Back pressed mid-transition, or a
        // browser that never fired it): treat it as the user's.
      }

      if (!entry) {
        // An entry from before this page load. Nothing of ours is above it
        // now, so start over at the root there.
        beneath.current = [];
        apply(initial);
        try { window.history.replaceState(entryState(0), ''); } catch { /* sandboxed */ }
        return;
      }

      const delta = entry.screenDepth - fromDepth;
      if (delta >= 0) {
        // Forward: the screens above were discarded when the user backed out
        // of them, so there is nothing to show. Put the browser back.
        move(-delta, fromDepth);
        return;
      }

      const leaving = current.current;
      if (opts.current.onUserBack?.(leaving) === true) {
        // Handled by the app (an overlay closed): restore the entry.
        move(-delta, fromDepth);
        return;
      }

      // The browser went back |delta| entries; only the last of them is shown.
      // A dead one (its row was deleted since) is skipped, and the browser is
      // asked to go back once more for each one skipped.
      for (let i = 1; i < -delta; i++) beneath.current.pop();
      let extra = 0;
      let next: S | null = null;
      for (;;) {
        const candidate = beneath.current.pop();
        if (candidate === undefined) break;
        const shown = opts.current.restore ? opts.current.restore(candidate) : candidate;
        if (shown !== null) { next = shown; break; }
        extra += 1;
      }
      apply(next ?? initial);
      if (extra > 0) move(-extra, beneath.current.length);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // `initial` is the root and never changes identity in practice; the
    // helpers are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setScreen = useCallback((next: SetStateAction<S>) => {
    const from = current.current;
    const to = typeof next === 'function' ? (next as (prev: S) => S)(from) : next;
    if (to === from) return;

    if (to.type === from.type) {
      apply(to);
      return;
    }

    const depth = beneath.current.length;
    if (opts.current.isRoot(to)) {
      beneath.current = [];
      apply(to);
      move(-depth, 0);
      return;
    }

    // Already in the stack: unwind to it rather than pushing, so the screens
    // above it (an editor just saved from, a detail of a row just deleted)
    // are not left in the history to be replayed by Back.
    for (let i = depth - 1; i >= 0; i--) {
      if (beneath.current[i].type === to.type) {
        beneath.current = beneath.current.slice(0, i);
        apply(to);
        move(-(depth - i), i);
        return;
      }
    }

    beneath.current.push(from);
    try { window.history.pushState(entryState(beneath.current.length), ''); } catch { /* sandboxed */ }
    apply(to);
  }, [apply, move, entryState]);

  return [screen, setScreen] as const;
}
