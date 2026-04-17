

## Focus Mode → Next Exercise/Superset Transition

When the focused block changes in Focus Mode (next exercise OR next exercise within a superset cycle), briefly reveal the underlying active session scrolled to the new block, then return to Focus Mode showing it.

### Trigger
Any time `pickFocusedBlockIdx(blocks)` returns a different index than before, including:
- Completing the last set of an exercise → next exercise
- **Completing a set + drops in a superset → cycling to the next exercise in the same superset group**
- Completing the final round of a superset → next exercise/group
- Workout complete (`null`) → scroll to top

### Behavior
1. User completes a set (parent + all drops) in Focus Mode.
2. `FocusMode` detects `focusedIdx` changed.
3. Focus Mode root fades to ~30% opacity, `pointer-events-none`.
4. ActiveSession underneath smooth-scrolls to the new focused block (centered).
5. After ~900ms, Focus Mode fades back to full opacity now rendering the new block.

### Implementation

**`src/components/ActiveSession.tsx`**
- Add `blockRefs = useRef<(HTMLDivElement | null)[]>([])`, attach to each block wrapper.
- Add `scrollToBlock(idx: number | null)`:
  - If `idx === null` → scroll window to top.
  - Else → `blockRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
- Pass `scrollToBlock` as a prop to `<FocusMode />`.

**`src/components/FocusMode.tsx`**
- New prop: `scrollToBlock: (idx: number | null) => void`.
- `previousFocusedIdx = useRef<number | null>(focusedIdx)`.
- `isTransitioning` state.
- `useEffect` on `focusedIdx`:
  - If `previousFocusedIdx.current !== null && previousFocusedIdx.current !== focusedIdx`:
    1. `setIsTransitioning(true)`.
    2. `props.scrollToBlock(focusedIdx)`.
    3. Timeout 900ms → `setIsTransitioning(false)`.
  - Update `previousFocusedIdx.current = focusedIdx`.
  - Cleanup timeout on re-trigger (handles rapid superset cycling).
- Root div: `className={cn(..., isTransitioning && 'opacity-30 pointer-events-none')}` with `transition-opacity duration-300`.

### Edge cases
- Rapid superset cycling (A→B→C within seconds): clear pending timeout, restart with latest `focusedIdx`. Each cycle still gets its own peek.
- First mount: no previous → no transition.
- Workout complete: scroll to top, fade back to "Workout complete" card.

### Files
- Modify: `src/components/ActiveSession.tsx`
- Modify: `src/components/FocusMode.tsx`

### Unchanged
- All set-logging, timer, superset cycling, dropset, and progression logic.

