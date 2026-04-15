

## Plan: Exercise-Type-Aware Inputs + Negative Weight Support

### Overview
Replace the one-size-fits-all Weight/Reps/RPE columns with mode-specific inputs based on exercise type. Sports (basketball, soccer, etc.) are already categorized under `primaryBodyPart: 'Cardio'` in the database, so they'll automatically get the cardio treatment.

### Exercise Input Modes

| Mode | Trigger | Columns |
|------|---------|---------|
| `weighted` | Default | Weight, Reps, RPE |
| `cardio` | `primaryBodyPart === 'Cardio'` (includes all sports) | Time (min), RPE |
| `band` | `equipment === 'Band'` | Band Level (select), Reps, RPE |

**Band Levels** (stored as numeric 1–6 in the `weight` field):
1. Extra Light (~5 lb / ~2 kg)
2. Light (~15 lb / ~7 kg)
3. Medium (~25 lb / ~11 kg)
4. Heavy (~40 lb / ~18 kg)
5. Extra Heavy (~55 lb / ~25 kg)
6. Monster (~80 lb / ~36 kg)

### Negative Weight for Assisted Exercises
Weight inputs will explicitly allow negative numbers (e.g., -20 kg for assisted pull-ups). No `min` attribute restriction. This applies to all weighted exercises.

### Changes

**1. New file: `src/utils/exerciseInputMode.ts`**
- `getExerciseInputMode(exerciseId)` returns `'weighted' | 'cardio' | 'band'`
- `BAND_LEVELS` array with label + weight approximations per unit system
- `formatBandLevel(level, unit)` helper for display

**2. `src/types/workout.ts`**
- Add `time?: number` to `WorkoutSet` (for persisted cardio data)
- Add `bandLevel?: number` as alias documentation (stored in `weight`)

**3. `src/components/ActiveSession.tsx`**
- Import `getExerciseInputMode` and `BAND_LEVELS`
- Per exercise block, determine mode from `block.exerciseId`
- **Cardio**: replace Weight+Reps columns with single Time (min) input; hide weight cascade logic
- **Band**: replace weight `<input>` with a `<select>` dropdown showing band level labels
- **Weighted**: unchanged, but ensure no `min` attribute blocks negative values
- Update `finishWorkout` to map cardio time and band level into `WorkoutSet`

**4. `src/components/TemplateBuilder.tsx`**
- Per block, detect mode and swap column headers/inputs accordingly
- Cardio: show "Target Time (min)" instead of weight/reps
- Band: show band level selector instead of weight

**5. `src/components/SessionSummary.tsx`**
- Format exercise summaries per mode (e.g., "30 min" for cardio, "Medium band" for bands)

**6. `src/components/WorkoutLog.tsx`**
- Mode-aware set display in history view

**7. `src/components/ActivityScreen.tsx`**
- Format history list items per mode

**8. `src/components/FutureWorkoutDetail.tsx`**
- Show appropriate column labels when previewing scheduled workouts

### What stays the same
- Exercise database structure (sports already in Cardio category)
- Database schema (band level reuses weight field, time field added to WorkoutSet)
- RPE column shown for all modes
- All existing weighted exercise behavior

