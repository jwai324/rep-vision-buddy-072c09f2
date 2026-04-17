

## Fix Focus Mode transition fade

### Problem
Focus Mode dims to 30% but never restores to full opacity — the `setTimeout` fade-back isn't reliably firing (likely because `scrollToBlock` identity changes re-run the effect and the cleanup clears the timeout before it fires).

### Changes

**`src/components/FocusMode.tsx`**
1. **Fade to fully transparent (0%)** instead of 30% during the transition, so the underlying ActiveSession is fully visible.
2. **Smoother fade in/out** — use `transition-opacity duration-500` so both the fade-out and fade-in are visibly animated.
3. **Fix the timeout never resolving**:
   - Narrow the effect's dependency array to `[focusedIdx]` only (remove `scrollToBlock` so a new function identity doesn't re-trigger and clobber the timer).
   - Read `scrollToBlock` via a ref so the latest version is always used without being a dependency.
4. Keep `pointer-events-none` during transition so taps go through to the active session beneath.
5. Total cycle: ~500ms fade out → hold ~400ms while scrolling → 500ms fade back in (≈1400ms total). Adjustable in one constant.

### Files
- Modify: `src/components/FocusMode.tsx`

### Unchanged
- `ActiveSession.tsx`, scrollToBlock implementation, all set/timer/superset logic.

