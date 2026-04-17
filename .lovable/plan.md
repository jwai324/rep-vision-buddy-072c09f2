

## Add Focus Mode to Active Session

### 1. Entry point on ActiveSession header
**File:** `src/components/ActiveSession.tsx`
- Add a compact "Focus Mode" button in the header row (line ~1449, next to Discard / Finish, hidden in `isEditMode`). Icon: `Crosshair` or `Focus` from lucide-react. Wired to `setShowFocusMode(true)`.
- Add local state `const [showFocusMode, setShowFocusMode] = useState(false)`.
- Render `<FocusMode .../>` as a full-screen overlay (z-50 fixed inset-0) when `showFocusMode` is true. Pass through everything it needs (see §5). Existing screen stays mounted underneath, preserving timers / cache / state.

No other changes to the existing screen.

### 2. New component: `src/components/FocusMode.tsx`
Full-screen modal layout (top → bottom):

```text
┌──────────────────────────────┐
│ ← Close                      │  ← top bar
├──────────────────────────────┤
│                              │
│    [Animation placeholder]   │  ← neutral box, fades into next region
│         (TODO marker)        │
│                              │
│  ░░░ gradient mask to bg ░░░ │
├──────────────────────────────┤
│ Exercise Name                │
│ (Set N of M • optional       │
│  superset position)          │
├──────────────────────────────┤
│ <ExerciseTable .../>         │  ← reused as-is
│  (sets, dropsets, edit,      │
│   complete, start/stop set)  │
└──────────────────────────────┘
```

Details:
- **Animation region**: ~40% of viewport height, rounded card, subtle bg (`bg-secondary/40`). Centered "Animation" label + icon. Bottom edge: a `pointer-events-none` div with `bg-gradient-to-b from-transparent to-background` for ~64px to soft-fade into the page.
  - `// TODO: replace with <ExerciseAnimation exerciseName={...} movementPattern={...} /> once wired`
- **Exercise name**: large title under the animation region.
- **Sets list**: render the existing `ExerciseTable` with the focused block. All edit / complete / start / stop / dropset / rest-timer behavior comes for free because we pass the same handlers.

### 3. Focused exercise selection logic (inside FocusMode)
Pure derivation from `blocks` — no duplicated state.

A helper `pickFocusedBlockIdx(blocks): number | null`:
1. **Find the next pending superset group** (lowest `supersetGroup` that still has any incomplete set across all its blocks). Among blocks in that group:
   - Compute, per block, `completedRounds` = number of leading sets where the parent is `completed` AND every drop in `drops` is `completed`.
   - The focused block in the group is the one with the **minimum `completedRounds`** (ties → earliest blockIdx). This implements the cycle:
     - All blocks start at round 0 → focus first block.
     - User completes its set 1 + any drops → its `completedRounds` becomes 1 → next block (still 0) gets focus.
     - …continues until last block hits 1 → first block becomes the min again for set 2.
   - If a chosen block has no further incomplete sets but the group still has incomplete sets in other blocks, skip it (filter to blocks with at least one incomplete set inside the group before picking min).
2. **Otherwise** (no superset group active): pick the first block (lowest blockIdx) that still has any incomplete set (parent or drop).
3. If none found → workout complete state.

A set is considered "fully complete for cycling" only when:
- parent `set.completed === true`, AND
- every entry in `set.drops ?? []` has `completed === true`.

This satisfies "do not cycle if dropsets remain incomplete on the current set."

### 4. Workout complete state
If `pickFocusedBlockIdx` returns `null`: show centered "Workout complete" card with a button to either close Focus Mode (returns to active session where user finishes/saves) or call the existing finish flow (close Focus Mode and let user tap Finish on the main screen — keeps responsibility in one place).

### 5. Props passed from ActiveSession to FocusMode
Pass exactly the props `ExerciseTable` already needs, scoped to the focused block:
- `blocks`, `weightUnit`, `customExercises`-derived `inputMode`, `activeTimer`, `restRecords`, `previousSets` (via existing `getPreviousExerciseData`), `runningSet`
- Handlers: `updateSet`, `toggleSetComplete`, `addSet`, `addDrop`, `updateDrop`, `removeSet`, `removeDrop`, `handleMenuAction`, `startTimer`, `skipTimer`, `extendTimer`, `handleStartNextSet`, `handleStopSetClick`
- `getStickyNote(block.exerciseId)`
- `onClose: () => setShowFocusMode(false)`

Because state lives in `ActiveSession`, edits in Focus Mode reflect instantly when closing back, and vice versa.

### 6. Reuse, not reimplementation
- `ExerciseTable` is already a self-contained, props-driven component. Render the same `<ExerciseTable …/>` JSX block currently used inside the blocks loop, with `blockIdx` set to the focused index. No extraction needed.
- All timer / superset / dropset / persistence behavior comes through unchanged because we route through the existing handlers and existing `runningSet` / `activeTimer` state.

### 7. Edge cases
- Workout has zero exercises → "Workout complete" state (or "Add an exercise on the main screen").
- Focused block changes mid-stream (e.g., user completes set inside Focus Mode) → component re-renders with new `pickFocusedBlockIdx`, automatically advancing to the next exercise in the superset or the next exercise in the workout.
- Adding/removing exercises is intentionally not exposed in Focus Mode (kept minimal). The `MoreHorizontal` per-exercise menu inside `ExerciseTable` still works (notes, drop sets toggle, rest timer, etc.).

### Files
- **Modify**: `src/components/ActiveSession.tsx` (add button + state + render overlay)
- **Create**: `src/components/FocusMode.tsx`

### Unchanged
- All existing active session UI, timers, persistence, superset coloring, dropset logic, set serialization, summary screen.

