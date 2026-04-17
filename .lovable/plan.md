

## Scroll exercise search to top on open

### Cause
`ExerciseSelector.tsx` already has a `useEffect` that targets the Radix ScrollArea viewport, but:
- It runs once on mount with no retry, and the Radix viewport may not be queryable in the same tick.
- It only resets the inner ScrollArea — not the window/page scroll, which matters when `BrowseExercisesScreen` mounts at a scrolled page position.
- It doesn't reset when search/filter state pre-exists (not the issue here, but worth covering).

### Fix (1 file: `src/components/ExerciseSelector.tsx`)
Replace the existing mount `useEffect` with a more robust version:
1. Scroll the Radix viewport to top using a `requestAnimationFrame` (so the viewport node exists).
2. Also call `window.scrollTo(0, 0)` so the page itself starts at the top when this screen opens (covers `BrowseExercisesScreen` and `ActiveSession` add-exercise flow).
3. Keep dependency array empty — runs once per mount, which matches "when opening the page."

No other files need changes; all entry points (`BrowseExercisesScreen`, `ActiveSession`, `TemplateBuilder`) mount `ExerciseSelector` fresh, so the mount effect fires every time the user opens the search.

### What stays the same
- Search/filter state, list rendering, selection logic.

