

## New Focus Mode transition: name promotion

Replace the current fade-out + background-scroll + fade-in sequence with a single self-contained animation where the "Up next" name rises and grows into the title spot, then the rest of the new exercise UI fades in.

### Behavior (when `focusedIdx` changes)
1. Capture the outgoing block's name in the title slot.
2. Everything in the FocusMode overlay fades to 0 opacity — **except** a floating element rendering the next exercise name, which starts at the position/size of the "Up next" footer.
3. That floating name simultaneously slides up and scales from footer style (`text-base`, muted) to title style (`text-3xl sm:text-4xl`, foreground), landing in the exercise-title slot.
4. Once it lands, the rest of the new focused block (animation region, meta line, ExerciseTable, new "Up next" footer) fades back in underneath.
5. No background scrolling, no peek of ActiveSession.

### Implementation (`src/components/FocusMode.tsx`)
- **Remove**: `scrollToBlockRef` usage + the `scrollToBlock(focusedIdx)` call inside the transition effect. (Prop kept but unused, or removed entirely from `ActiveSession.tsx` call site.)
- **Remove**: root-level `opacity-0` fade.
- **Add state**:
  - `phase: 'idle' | 'promoting' | 'revealing'`
  - `promotingName: string | null` — name being promoted (the new exercise's name).
  - `displayedIdx` — the focused index actually rendered, updated only after promotion finishes so the old block stays visible while the name flies.
- **Refs** for measuring positions:
  - `titleSlotRef` (current title `<h2>`)
  - `upNextSlotRef` (current "Up next" name span)
- **Transition trigger** (`useEffect` on `focusedIdx`):
  1. Read bounding rects of `upNextSlotRef` (start) and `titleSlotRef` (end).
  2. Compute `translateY` and `scale` deltas for a FLIP-style animation.
  3. `setPhase('promoting')`, set `promotingName = blocks[focusedIdx].exerciseName`, render the floating clone with inline transform from start → end (`transition: transform 500ms ease, font-size/color via class swap at end`).
  4. After 500ms: `setDisplayedIdx(focusedIdx)`, `setPhase('revealing')` (clone unmounts, real title shows the name immediately so there's no flash).
  5. After another 300ms reveal: `setPhase('idle')`.
- **Render layers during transition**:
  - Outgoing block content wrapped in a div with `transition-opacity duration-300`, set to `opacity-0` during `promoting`.
  - Floating clone: `fixed`, starts at upNext rect, animates to title rect; text classes interpolate via two-state Tailwind swap (start: `text-base text-muted-foreground font-medium`, end: `text-3xl sm:text-4xl font-bold text-foreground`).
  - Incoming block content: rendered when `phase === 'revealing'` with `animate-fade-in` (Tailwind already exposes this keyframe).
- **Edge cases**:
  - No next exercise (workout complete): skip promotion, just fade out → show "Workout complete" card with `animate-fade-in`.
  - First mount (`previousFocusedIdx.current === null`): no animation.
  - Rapid completions: if a new transition fires while one is in flight, cancel current timers, snap to the new target, restart promotion from the new "Up next" position.

### Files
- Modify: `src/components/FocusMode.tsx` (new transition logic, FLIP measurement, phased render)
- Modify: `src/components/ActiveSession.tsx` (drop the `scrollToBlock` prop pass — no longer needed; keep the helper or remove it)

### Unchanged
- All set-logging, timer, superset cycling, dropset, ExerciseTable, and `pickFocusedBlockIdx` logic.

