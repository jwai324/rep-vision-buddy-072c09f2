
## Split the "Today's Workout" card interactions

On the Dashboard's "Today's Workout" card:
- **Tapping the card body** (background, name, exercise list) → opens the same `FutureWorkoutDetail` page used for upcoming workouts.
- **Tapping the "Start Today's Workout" button** → starts the session immediately (current behavior).

### Implementation

1. **`Dashboard.tsx`**
   - Add prop `onOpenTodayWorkout: (template: WorkoutTemplate, dateStr: string) => void`.
   - Convert the "Today's Workout" card `<div>` into a `<button>` (or a clickable wrapper) that calls `onOpenTodayWorkout(todayTemplate, todayDateStr)`.
   - Keep the existing `Button` ("Start Today's Workout") inside; add `onClick` with `e.stopPropagation()` so it still calls `onStartTemplate(todayTemplate)` without also triggering the card open.

2. **`Index.tsx`**
   - Add `handleOpenTodayWorkout(template, dateStr)`:
     - Look for an existing `FutureWorkout` matching `date === dateStr && templateId === template.id`.
     - If found → navigate to `{ type: 'futureWorkoutDetail', futureWorkout: existing }`.
     - Else → synthesize one (`id: 'synthetic-' + dateStr`, `programId: activeProgramId ?? 'manual'`, `templateId: template.id`, `date: dateStr`, `label: template.name`) and navigate.
   - Reuses the existing synthetic→real id-rewrite adapter, so persistence on the detail page already works.
   - Pass the new handler as `onOpenTodayWorkout` to `<Dashboard />`.

### Files
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/pages/Index.tsx`

### Unchanged
- `FutureWorkoutDetail`, `FutureWorkoutsScreen`, `useStorage`, DB schema, RLS.

### Validation
- Tap the card body → `FutureWorkoutDetail` opens for today.
- Tap "Start Today's Workout" → session launches immediately (card does not also open detail).
- Upcoming workouts in `FutureWorkoutsScreen` behave the same as before.
