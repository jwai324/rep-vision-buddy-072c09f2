

## Plan: Include Custom Exercises in Analytics & Dashboard

### Problem
All analytics tabs (Volume, Strength, Frequency, Balance, Set Types, RPE) and the Dashboard's "Weekly Sets" widget build their exercise-to-body-part/pattern lookup maps using only `EXERCISE_DATABASE`. Custom exercises are ignored, causing their sets to be uncounted or categorized as "Other."

### Fix
Each component that builds a static map from `EXERCISE_DATABASE` needs to also include custom exercises. Since these are loaded asynchronously via React context, the static module-level maps must be moved inside the component and combined with custom exercises via `useMemo`.

### Files to Change

**1. `src/components/Dashboard.tsx`**
- Import `useCustomExercisesContext`
- Move `exerciseBodyPartMap` (line 67-69) inside the component as a `useMemo` that merges `EXERCISE_DATABASE` + custom exercises

**2. `src/components/analytics/VolumeTab.tsx`**
- Import `useCustomExercisesContext`
- Move `exerciseBodyPartMap` (line 8-10) inside the component as a `useMemo`

**3. `src/components/analytics/FrequencyTab.tsx`**
- Same pattern: move `exerciseBodyPartMap` inside component with custom exercises merged

**4. `src/components/analytics/BalanceTab.tsx`**
- Move `exercisePatternMap` (line 7-9) inside component, merge custom exercises

**5. `src/components/analytics/StrengthTab.tsx`**
- Update `exercisesInHistory` filter (line 28) and `getExerciseName` (line 60) to also search custom exercises

**6. `src/components/analytics/SetTypesTab.tsx`** and **`src/components/analytics/RpeTab.tsx`**
- Check if they use exercise lookups; update if needed

### Pattern (repeated in each file)
```tsx
const { exercises: customExercises } = useCustomExercisesContext();
const exerciseBodyPartMap = useMemo(() => {
  const map = new Map(EXERCISE_DATABASE.map(ex => [ex.id, ex.primaryBodyPart]));
  for (const ce of customExercises) map.set(ce.id, ce.primaryBodyPart);
  return map;
}, [customExercises]);
```

No database or backend changes needed.

