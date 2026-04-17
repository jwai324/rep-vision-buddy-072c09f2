

## Fix: Superset (and cardio time) data lost when editing a saved workout

### Root cause
`src/components/ActiveSession.tsx` lines 185–201 — `editBlocks` rebuilds blocks from `editSession.exercises` but does NOT copy `supersetGroup`. So when the user opens a completed workout → Edit → Save, every exercise is saved back without its superset link.

The same block also hardcodes `time: ''`, which drops cardio set times on edit.

### Fix (one file)
**`src/components/ActiveSession.tsx`** — in `editBlocks`:
1. Add `supersetGroup: ex.supersetGroup` to the block object.
2. Preserve cardio time: `time: s.time != null ? String(s.time) : ''`.

That's it — no other code paths need changes (save path already serializes `block.supersetGroup`, and `SessionSummary` already reads + color-codes by it).

### What stays the same
- `WorkoutSession` / `ExerciseLog` types (already have `supersetGroup`).
- Save/load layer (already round-trips the field via JSON).
- `SessionSummary` rendering (legacy inference fallback stays as a safety net).

