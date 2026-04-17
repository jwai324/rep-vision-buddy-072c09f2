
## Fix dropset & superset progression for "Start next set"

### Behavior
After tapping **Start next set**, advance in this order:

**Without superset** (single block):
- Set 1 → 1D1 → 1D2 → … → Set 2 → 2D1 → … → Set 3 …

**With superset group** (e.g. Ex A linked to Ex B and Ex C), interleave by set number:
- A.Set1 → A.1D1 → A.1D2 → B.Set1 → B.1D1 → C.Set1 → C.1D1 → A.Set2 → A.2D1 → B.Set2 → C.Set2 → A.Set3 → B.Set3 → C.Set3 …

**Rule**: complete current set + all its dropsets on the current exercise, then hop to the same set-number on the next exercise in the group, then hop to the same set-number on the next exercise in the group until all linked exercises' same set-number are completed, then return to the next set-number on the first exercise.

### Change (single file: `src/components/ActiveSession.tsx`)

1. **Extend state shape** to carry an optional `dropIdx`:
   - `countdown: { blockIdx, setIdx, dropIdx? }`
   - `runningSet: { blockIdx, setIdx, dropIdx?, startedAt }`

2. **Rewrite `handleStartNextSet(blockIdx)`** to find the next item:
   - Helper `findIncompleteDrop(set)`: returns first drop index where `!drop.completed`, or undefined.
   - **No superset group** → walk this block's sets in order; for each set, if drops have any incomplete go there, else if set itself incomplete go there. First match wins.
   - **Has superset group**:
     a. Build ordered list of sibling block indices in the group (by array order, including current).
     b. **Step 1 — finish current set's dropsets**: on the just-completed block, if the current set N has any incomplete drop, run that drop next.
     c. **Step 2 — same set-number on remaining siblings**: walk siblings after current (in group order). For each, if its set N exists and is incomplete (or has incomplete drops), run that set + its drops. Continue until set N is done across all siblings.
     d. **Step 3 — advance to set N+1**: loop back to the first sibling in the group whose set N+1 is incomplete; run set + drops; continue across siblings as in step 2.
     e. If no further incomplete set anywhere in the group → "All sets complete" toast.

3. **`handleCountdownComplete`**: if `dropIdx` is defined, set `startedAt` on `set.drops[dropIdx]` (not the parent set). Pass `dropIdx` into `runningSet`.

4. **`stopRunningSet`**: if `dropIdx` is defined, write `endedAt`/`completed`/`time` to `set.drops[dropIdx]` instead of the parent set. Use a composite rest-timer id (include `dropIdx` in the key) so each drop's rest is recorded independently.

5. **`skipTimer` / countdown stop logic**: unchanged behavior, just keyed by the new id when a drop is active.

### Files touched
- `src/components/ActiveSession.tsx` only.

### Unchanged
- Set/drop UI rendering, dropset toggle, rest timer overtime, SupersetLinker, persistence schema (drops already store `startedAt/endedAt/completed`).
