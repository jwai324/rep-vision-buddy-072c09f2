
The user wants a new monthly calendar page accessible by clicking the weekly calendar title on the dashboard. Clicking a day shows that day's content (planned workout, past session, or rest day) below the calendar.

I'll reuse existing logic: `buildProgramEvents` (from Dashboard), history matching, futureWorkouts matching, and the synthetic-FutureWorkout pattern from `Index.tsx`'s `onDayClick`.

### Plan

1. **New component** `src/components/MonthlyCalendarScreen.tsx`
   - Use shadcn `Calendar` (`mode="single"`) with `month` state for navigation.
   - Build a Set of dated markers from: completed sessions (workout vs rest), futureWorkouts (workout vs rest), and active program events.
   - Use `modifiers` + `modifiersClassNames` to dot/color days: green dot (completed workout), blue dot (completed rest), primary ring (scheduled workout), muted ring (scheduled rest).
   - Below the calendar render a detail card for the selected day:
     - If completed session(s) exist → show summary (template name or "Rest Day", duration, total sets/volume, exercises list via `useExerciseLookup`). Tap → open History detail (reuse `onOpenSession`).
     - Else if futureWorkout exists → show label, exercise preview, "Start" button (workout) or "Open" (rest day).
     - Else if active program defines that day → synthesize a FutureWorkout (same pattern as `Index.tsx`) and show it.
     - Else → "Nothing planned" with a quick "Add Rest Day" button.

2. **Wire screen into `src/pages/Index.tsx`**
   - Add `screen.type === 'monthlyCalendar'`.
   - Pass `history`, `templates`, `futureWorkouts`, `activeProgram`, and callbacks: `onBack`, `onStartTemplate`, `onOpenFutureWorkout` (reusing existing synthetic-materialization logic), `onOpenSession`, `onAddRestDay`.

3. **Dashboard entry point** — `src/components/Dashboard.tsx`
   - Add `onGoToMonthlyCalendar` prop.
   - In `WeeklyProgramCalendar`, make the title row (`📅 {program?.name ?? 'Calendar'}`) a button that calls it. Add subtle hover + chevron to signal it's tappable.

### Files
- Create: `src/components/MonthlyCalendarScreen.tsx`
- Modify: `src/components/Dashboard.tsx` (clickable title + new prop)
- Modify: `src/pages/Index.tsx` (new screen type + routing + reuse onDayClick logic)

### Unchanged
- DB schema, RLS, `useStorage`, program scheduling logic, `FutureWorkoutDetail`, `WorkoutHistory`.

### Validation
- Click the weekly calendar title → monthly calendar opens.
- Days with completed workouts/rests, scheduled future workouts, and program-defined rest days all show distinct markers.
- Clicking each type of day shows the correct detail below; tapping detail launches the right flow.
