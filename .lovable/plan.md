

## Loosely Match Active Workout Look in Workout Details

### Goal
Make completed workout details feel closer to the active session view without rebuilding the table. Add the missing visual cues: exercise icon in the header, a column-header row, and ActiveSession-style set-number badges (W1, 1D1, etc.) with proper dropset indentation.

### Changes (single file: `src/components/SessionSummary.tsx`)

In the exercise breakdown block (`exercisesWithGroups.map`):

1. **Exercise card header** — prepend the exercise emoji (`EXERCISES[ex.exerciseId]?.icon ?? '🏋️'`) next to `ex.exerciseName`, matching ActiveSession's icon + name spacing.

2. **Column header row** — add a small uppercase muted row above the sets:
   - Weighted: `SET · WEIGHT · REPS · RPE`
   - Cardio: `SET · TIME · RPE`
   - Band: `SET · BAND · REPS · RPE`

3. **Set-number badges** — replace the current "Normal/Set N" pill with ActiveSession's compact badge:
   - Warmup → `W1`, `W2`...
   - Normal/Failure/Superset → `1`, `2`, `3`...
   - Dropset → `1D1`, `1D2` (parent set number + `D` superscript), shown indented one level
   - Color-tinted via `SET_TYPE_CONFIG[type].colorClass` (already used).

4. **Dropset indentation** — render dropset rows with left padding/border so they visually nest under their parent normal set, matching ActiveSession.

5. **Keep as-is**: stats grid, note card, superset color wrapper (already there), edit/delete buttons, rest-day view, all spacing/typography of the outer card. No inputs, no checkmarks, no "previous" column.

### What stays the same
- `SessionSummary` props/interface.
- All non-exercise-breakdown sections.
- ActiveSession itself — untouched.

