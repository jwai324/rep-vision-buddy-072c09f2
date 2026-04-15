

## Plan: Add "Add Rest Day" Button to Dashboard

### What changes
A smaller, subtler "Add Rest Day" button on the dashboard that creates a rest-day entry for today and navigates to the rest day detail screen where recovery activities can be toggled and saved.

### Changes

**1. `src/components/Dashboard.tsx`**
- Add a new prop `onAddRestDay: () => void`
- Add a button below the "Start Workout" button, styled with `variant="outline"` and smaller size (`size="sm"`), showing a bed/moon emoji + "Add Rest Day" text
- Visually subdued compared to the neon Start Workout button

**2. `src/pages/Index.tsx`**
- Wire the new `onAddRestDay` prop on Dashboard
- Handler creates a `FutureWorkout` with `templateId: 'rest'`, today's date, and navigates to `futureWorkoutDetail` screen with it
- The existing `FutureWorkoutDetail` component already handles rest day activity selection and saving — no changes needed there

### What stays the same
- `FutureWorkoutDetail` component (already supports rest day editing)
- All other dashboard elements
- Storage/save logic (reuses existing `onSaveRestDay` flow)

