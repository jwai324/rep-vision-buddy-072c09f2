
## Three small additions

### 1. Auto-scroll when Start next set hops to a different exercise

**File:** `src/components/ActiveSession.tsx`

- Add a `blockRefs = useRef<Record<number, HTMLDivElement | null>>({})` map and pass a ref-setter into each rendered exercise block wrapper (the SortableExerciseItem container) so we can look up its DOM node by `blockIdx`.
- In `handleStartNextSet`, whenever the chosen `setCountdown({ blockIdx: target, ... })` uses a `target !== blockIdx` (i.e. we hopped to a sibling in the superset group), call `blockRefs.current[target]?.scrollIntoView({ behavior: 'smooth', block: 'center' })` right after `setCountdown`.
- Same-block advances do **not** scroll (keeps current scroll position stable for normal set-to-set progression).

### 2. Add a "time elapsed" field to dropset rows

**File:** `src/components/ActiveSession.tsx` (dropset row JSX around lines 2272–2316)

- Replace the empty `<span />` placeholder in the Timer column with a `<TimeInputButton>` bound to `drop.time`, mirroring how the parent set row uses it:
  ```tsx
  <TimeInputButton
    id={buildInputId(blockIdx, setIdx, 'time', dropIdx)}
    value={drop.time ?? ''}
    onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'time', v)}
    running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx && runningSet?.dropIdx === dropIdx}
    small
  />
  ```
- Confirm `onUpdateDrop` accepts a `'time'` field (extend the union if needed) and that the `DropSegment` type / drop row state already carries `time` (used by `stopRunningSet` for drops). If not present, add `time?: string` to the drop row state shape.

### 3. Clickable "Time" column header with a small definition popover

**File:** `src/components/ActiveSession.tsx` (table headers at lines 2076, 2096, 2118)

- Replace the three `<Timer />` icon spans (and the cardio "Time" text label at 2078) with a `Popover` trigger button — same pattern as the existing RPE header:
  ```tsx
  <Popover>
    <PopoverTrigger asChild>
      <button className="text-center w-full text-muted-foreground hover:text-primary transition-colors">
        <Timer className="w-3 h-3 mx-auto" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="center" className="w-56 p-3 text-xs leading-relaxed">
      <p className="font-semibold mb-1">Time elapsed</p>
      <p className="text-muted-foreground">Time it took to complete the set, captured automatically when you start and finish a set.</p>
    </PopoverContent>
  </Popover>
  ```
- Apply to all three header variants (cardio, band, weighted). Cardio's "Time" text header stays as-is (that column is the user-entered duration, not elapsed).

### Files touched
- `src/components/ActiveSession.tsx` only.

### Unchanged
- Progression logic itself, rest timer, countdown overlay, persistence schema.
