

## Plan: Add Arnold Press to Exercise Database

### What changes
- **`src/data/exercises.ts`** — Add a new Arnold Press entry next to the other dumbbell shoulder press exercises (after line 93):
  ```ts
  { id: 'arnold-press', name: 'Arnold Press', primaryBodyPart: 'Shoulders', equipment: 'Dumbbell', difficulty: 'Intermediate', exerciseType: 'Compound', movementPattern: 'Push', secondaryMuscles: ['Triceps', 'Front Delts'] },
  ```

### What stays the same
- All other exercises, constants, and components remain untouched

