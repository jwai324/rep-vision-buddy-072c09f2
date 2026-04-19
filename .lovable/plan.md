
This is a research question, not an implementation request. Let me investigate how missed workouts are handled in programs.

Key files to check:
- `src/components/FutureWorkoutDetail.tsx` — what options exist when opening a scheduled workout
- `src/pages/Index.tsx` — future workout generation/pruning logic
- Memory: `mem://features/future-workouts-system` — auto-fill and pruning rules
