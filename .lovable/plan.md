

## Add "Re-perform Workout" and "Save as Template" to workout detail/summary screens

### What changes

**1. SessionSummary.tsx — add two new action props and buttons**
- Add `onReperform?: (session: WorkoutSession) => void` prop.
- In the `isViewMode` action area (lines 428-443), add:
  - A "Re-perform Workout" neon button that calls `onReperform(session)` — placed at the top of the action group so it's the primary CTA.
  - A "Save as Template" outline button that calls `onSaveAsTemplate()` — placed after Re-perform, before Edit.
- Reorder: Re-perform > Save as Template > Edit > Delete.

**2. Index.tsx — wire the new callbacks in the `sessionDetail` screen**
- Add `onReperform` handler: converts the session's exercises into a `WorkoutTemplate` (same pattern used elsewhere) and calls `startFromTemplate(template)`.
- Fix the existing no-op `onSaveAsTemplate`: create a template from the session (using the same conversion logic as the summary screen) and save it via `storage.saveTemplate`, then show a toast confirming the template was saved and stay on the current screen.

### Conversion logic (session → template, reused pattern)
```ts
const template: WorkoutTemplate = {
  id: crypto.randomUUID(),
  name: `Workout ${new Date(session.date).toLocaleDateString()}`,
  exercises: session.exercises.map(ex => ({
    exerciseId: ex.exerciseId,
    sets: ex.sets.length,
    targetReps: ex.sets[0]?.reps ?? 10,
    setType: ex.sets[0]?.type ?? 'normal',
    restSeconds: 90,
  })),
};
```

### Files
- Modify: `src/components/SessionSummary.tsx`
- Modify: `src/pages/Index.tsx`

