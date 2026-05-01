
## Add Measurement Type to Exercise System

This is a large feature spanning data sync, type system, UI inputs, and display logic. Here is the phased plan.

---

### Phase 1 -- Notion Sync + Data Layer

**1a. Update `scripts/sync-notion-aliases.ts` to also pull "Measurement Type"**

- Extend the `NotionPage` interface to include `"Measurement Type": { select: { name: string } | null }`.
- Build a `measurementTypeMap: Map<exerciseName, string>` alongside the existing `aliasMap`.
- When writing back to `exercises.ts`, inject `measurementType: 'Time'` (etc.) into each matching exercise object line, similar to how `aliases` are injected.

**1b. Extend the `Exercise` interface in `src/data/exercises.ts`**

- Add `measurementType?: 'Reps' | 'Reps + Weight' | 'Time' | 'Distance' | 'Time + Distance' | null` to the `Exercise` interface.
- After running the updated sync script, exercises like Plank will have `measurementType: 'Time'`, Running (Steady State) will have `measurementType: 'Time + Distance'`, Elliptical will have `measurementType: 'Time'`, and most strength lifts will have `null`/no value.

**1c. Run the sync script and verify spot checks**

- Plank -> "Time", Running (Steady State) -> "Time + Distance", Elliptical -> "Time", Bench Press -> null.

---

### Phase 2 -- Data Model Changes

**2a. Extend `WorkoutSet` in `src/types/workout.ts`**

- Add optional fields: `distance?: number` (stored in meters).
- The existing `time` field (seconds) and `weight`/`reps` fields remain. `time` is already used for cardio.

**2b. Replace `ExerciseInputMode` in `src/utils/exerciseInputMode.ts`**

- Change the type from `'weighted' | 'cardio' | 'band'` to `'reps' | 'reps-weight' | 'time' | 'distance' | 'time-distance' | 'band'`.
- Update `getExerciseInputMode()` to check `exercise.measurementType` first:
  - `'Reps'` -> `'reps'`
  - `'Reps + Weight'` -> `'reps-weight'`
  - `'Time'` -> `'time'`
  - `'Distance'` -> `'distance'`
  - `'Time + Distance'` -> `'time-distance'`
  - `null/undefined` -> fall back to existing logic (band check, cardio check, else `'reps-weight'`)
  - Log a console warning for null/missing measurementType.
- Update `formatSetDisplay()` to handle the new modes.

---

### Phase 3 -- Set-Logging UI (ActiveSession)

The set row inputs in `ActiveSession.tsx` currently switch on `ExerciseInputMode`. Update the rendering logic:

| Mode | Inputs |
|------|--------|
| `reps` | Reps only |
| `reps-weight` | Reps + Weight + unit toggle |
| `time` | Duration mm:ss (manual entry + start/stop timer button) |
| `distance` | Distance + unit toggle (mi/km/m) |
| `time-distance` | Duration mm:ss + Distance + unit toggle |
| `band` | Band level selector + Reps (unchanged) |

- For "Time" exercises, add a small play/stop button next to the mm:ss input that starts a live timer and captures the elapsed value on stop.
- For "Time + Distance", show both inputs side-by-side on desktop, stacked on mobile.
- `distance` is stored in meters; converted to user-preferred unit on display.

---

### Phase 4 -- Display, History & Aggregation

**4a. Update all display components** that call `getExerciseInputMode()`:
- `SessionSummary.tsx`, `WorkoutLog.tsx`, `ActivityScreen.tsx`, `FutureWorkoutDetail.tsx`, `TemplateBuilder.tsx`, `FocusMode.tsx`
- Each must handle the new modes for formatting set data.

**4b. Volume/aggregation logic**
- For `reps-weight` and `band`: volume = reps x weight (unchanged).
- For `time` and `time-distance`: aggregate total duration (seconds). Do not compute "volume".
- For `distance` and `time-distance`: aggregate total distance.
- For `reps`: aggregate total reps only.

**4c. Legacy data**: Old sets with no `distance` field render as before (Reps + Weight fallback).

---

### Phase 5 -- Exercise Picker Badge

In `ExerciseSelector.tsx`, add a small badge/chip on each exercise tile showing the measurement type icon:
- Reps: "# Reps"
- Reps + Weight: "# Weight" (or no badge, since it's the default)
- Time: "clock Time"
- Distance: "ruler Distance"
- Time + Distance: "clock+ruler"
- null: no badge

---

### Phase 6 -- Custom Exercises

- Update `CreateExerciseForm.tsx` to include a "Measurement Type" select dropdown.
- Update the `custom_exercises` table with a new `measurement_type` nullable text column (DB migration).
- Wire the custom exercise lookup in `getExerciseInputMode()` to also check `measurementType`.

---

### Files to modify/create

| File | Change |
|------|--------|
| `scripts/sync-notion-aliases.ts` | Pull Measurement Type from Notion, inject into exercises.ts |
| `src/data/exercises.ts` | Add `measurementType` to Exercise interface + synced values |
| `src/types/workout.ts` | Add `distance?: number` to `WorkoutSet` |
| `src/utils/exerciseInputMode.ts` | New modes, updated logic, updated formatSetDisplay |
| `src/components/ActiveSession.tsx` | Conditional set-row inputs per mode |
| `src/components/SessionSummary.tsx` | Updated display for new modes |
| `src/components/WorkoutLog.tsx` | Updated display for new modes |
| `src/components/ActivityScreen.tsx` | Updated display for new modes |
| `src/components/FutureWorkoutDetail.tsx` | Updated display for new modes |
| `src/components/TemplateBuilder.tsx` | Updated display for new modes |
| `src/components/FocusMode.tsx` | Updated display for new modes |
| `src/components/ExerciseSelector.tsx` | Measurement type badge |
| `src/components/CreateExerciseForm.tsx` | Measurement type dropdown |
| DB migration | Add `measurement_type` column to `custom_exercises` |

---

### What stays unchanged

- Training Style, Movement Pattern, Difficulty, Equipment fields
- Auth, routing, theme
- The core exercise library entries (AI constraint) -- only adding the new property via Notion sync
