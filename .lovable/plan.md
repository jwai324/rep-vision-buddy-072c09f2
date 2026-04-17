
## Per-set start/stop timing with 5s countdown overlay + mm:ss display

### Goals
1. Format the existing `time` field everywhere as `mm:ss` (e.g. `1:25`) instead of "1.42 min".
2. Add a "Start next set" button to the right of each exercise name in `ActiveSession`.
3. Tapping it shows a full-screen semi-transparent 5-second countdown overlay.
4. After the countdown, the next uncompleted set in that exercise gets a `startedAt` timestamp; the button changes to "Stop set".
5. Tapping "Stop set" records `endedAt`, computes `time` (seconds), auto-checks the set as complete, and starts the rest timer.
6. Tapping "Start next set" while a set is already running: stop current set (record end + 5s), then begin the 5-second countdown for the next uncompleted set.
7. Persist `startedAt` / `endedAt` on each `SetRow` so a refresh doesn't lose state (via existing `active-session-cache`).

### Data model changes

**`SetRow` (in `ActiveSession.tsx`)** — add two optional fields:
```ts
interface SetRow {
  // ... existing
  startedAt?: number;  // epoch ms
  endedAt?: number;    // epoch ms
  // 'time' string remains; we'll write the duration in seconds when the set stops
}
```
No change needed to `WorkoutSet` in `src/types/workout.ts` — `time` is already `number` (we'll change its semantic from "minutes" to "seconds" only for newly-tracked sets; existing data is small/none and the formatter handles both).

**Storage convention going forward**: `time` = total seconds for the set. The display formatter renders `mm:ss`. The cardio "Time (min)" column header becomes "Time" and accepts mm:ss input.

### New utility: `src/utils/timeFormat.ts`
```ts
export function formatMmSs(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}
export function parseMmSs(input: string): number | null {
  // Accept "1:25", "85", "1.5" (legacy minutes) → returns seconds
}
```

### New component: `src/components/CountdownOverlay.tsx`
Full-screen `fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm` overlay. Displays a giant centered number (5 → 1) with a soft pulse animation. Auto-dismisses on 0 and calls `onComplete()`. Tap-to-cancel via `onCancel()` (small "Cancel" pill at the bottom).

Implementation: simple `useEffect` with `setTimeout` per second, no external deps.

### `ActiveSession.tsx` changes

1. **State**:
   ```ts
   const [countdown, setCountdown] = useState<{ blockIdx: number; setIdx: number; n: number } | null>(null);
   const [runningSet, setRunningSet] = useState<{ blockIdx: number; setIdx: number; startedAt: number } | null>(null);
   ```

2. **Handler `handleStartNextSet(blockIdx)`**:
   - If a set is currently running in this block → call `handleStopSet()` first (which writes end = now + 5s, completes set, starts rest timer).
   - Find the first set in `blocks[blockIdx]` where `!completed`.
   - If none → toast "All sets complete".
   - Otherwise → trigger countdown overlay with `n: 5`. On completion, set `startedAt = Date.now()` on that `SetRow` and set `runningSet`.

3. **Handler `handleStopSet()`**:
   - Read `runningSet`. Set `endedAt = Date.now()`, compute `seconds = round((endedAt - startedAt)/1000)`, write into `set.time` as `String(seconds)`, mark `completed = true`, clear `runningSet`.
   - Re-use existing `startTimer({ type: 'set', blockIdx, setIdx }, restSeconds)` to start the rest timer.
   - Reuse the auto-fill cascade logic already in `toggleSetComplete` (we'll factor a small helper or pass through the same setBlocks update).

4. **Header button per exercise (in `ExerciseTable` header, line ~1697-1739)**:
   Insert between exercise name and the `MoreHorizontal` menu:
   ```tsx
   <button onClick={() => onStartNextSet(blockIdx)}
     className="text-[10px] font-bold px-2 py-1 rounded-md bg-primary text-primary-foreground">
     {isRunningHere ? 'Stop set' : 'Start next set'}
   </button>
   ```
   Pass `onStartNextSet` and `runningSet` into `ExerciseTable` props.

5. **Render `<CountdownOverlay>` at the root of the component** when `countdown !== null`.

6. **Persist `startedAt` / `endedAt` / `runningSet`** in the existing `ActiveSessionCache` so a reload while a set is timing won't lose state. Add `runningSet` to `ActiveSessionCache` interface and the cache-write effect.

### Time field display + input

- **Cardio row** (line ~1847-1856): replace numeric `<input>` with a tappable button that shows `formatMmSs(parseInt(set.time||'0'))` or `—`. On tap → opens a small popover with a `mm:ss` text input (or two number inputs for minutes/seconds). Same for the time cell on the weighted row (line ~1940-1949) — currently a plain text input shown in mono font.
- **Header label**: change "Time (min)" → "Time".
- **Read-only display elsewhere**: update `formatSetDisplay` in `src/utils/exerciseInputMode.ts` to use `formatMmSs` (cardio + weighted), and `WorkoutLog.tsx` cardio summary to `mm:ss` total.

### Edge cases
- Tapping "Start next set" while countdown is showing → ignore (countdown owns the screen).
- Cancelling countdown → no `startedAt` written, button reverts to "Start next set".
- "Stop set" with no `runningSet` → no-op.
- Editing a session (`isEditMode`) → hide the "Start next set" button (no live timing in edit mode).
- Per-block runningSet: only one set across the whole workout can be "running" at a time (`runningSet` is a single state). Tapping "Start next set" on a different exercise stops the current run first.

### Files touched
- `src/components/ActiveSession.tsx` — state, handlers, header button, overlay render, cache fields, time cell display, input popover.
- `src/components/CountdownOverlay.tsx` (new).
- `src/utils/timeFormat.ts` (new).
- `src/utils/exerciseInputMode.ts` — `formatSetDisplay` cardio branch uses `formatMmSs`.
- `src/components/WorkoutLog.tsx` — cardio total in `mm:ss`.

### What stays the same
- `WorkoutSet.time` schema, RPE picker, rest timer logic, completion validation, swipe-to-delete, supersets, dropsets (drops don't get a per-drop runner — the parent set timer covers the whole sequence).
