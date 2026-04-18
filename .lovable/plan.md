

## Fix "failed to update future workout" when adding rest activities

### Root cause
Clicking the 17th opens a synthesized `FutureWorkout` with:
- `id: 'synthetic-2026-04-17'` (not a UUID)
- `programId: storage.activeProgramId ?? 'manual'` (could be `'manual'` — not a UUID)

When the user adds a recovery activity, `FutureWorkoutDetail` calls `onUpdateFutureWorkout`, which upserts into `future_workouts` where `id` and `program_id` are `uuid` columns. Postgres rejects the non-UUID `id`, so the toast "Failed to update future workout" fires and nothing persists.

### Plan

**1. Materialize the synthetic FutureWorkout on first update** — `src/pages/Index.tsx`
- In the `futureWorkoutDetail` render block (~line 360), wrap `storage.updateFutureWorkout` with a small adapter:
  - If the incoming `fw.id` starts with `'synthetic-'`, generate a real `crypto.randomUUID()`, replace the id, and only pass through if there is a valid `programId` (real UUID, not `'manual'`).
  - Persist via `storage.updateFutureWorkout` (which upserts), then update `screen` so subsequent edits target the new real id.
- Also guard `onSaveRestDay` to use the same id rewrite if needed (it writes a `WorkoutSession`, not `future_workouts`, so likely already fine — verify).

**2. Skip persistence when no active program is set**
- If `storage.activeProgramId` is null (synthetic from a non-program rest day), do NOT pass `onUpdateFutureWorkout` to `FutureWorkoutDetail`. The component already falls back to local state when the prop is undefined, so the user can still tap activities and "Save Rest Day" to log it as a session — just without persisting an in-progress `future_workouts` row.

**3. Don't break the "manual" rest day flow** (~line 143, the dashboard plus-button restFw)
- That existing path uses `programId: 'manual'`. Same fix applies — if `programId === 'manual'` or starts with non-UUID, treat as local-only (no `onUpdateFutureWorkout`). User can still complete + save it via `onSaveRestDay`.

### Files
- Modify: `src/pages/Index.tsx` (id-rewrite adapter + conditional prop passing)

### Unchanged
- `useStorage.updateFutureWorkout`, DB schema, RLS, `FutureWorkoutDetail` component.

### Validation
- Tap the 17th, add a recovery activity → no error, activity persists across navigation.
- Add a manual rest day from the dashboard plus button, add an activity → still works (local state), Save Rest Day logs a session.
- Existing real `future_workouts` rows still update normally.

