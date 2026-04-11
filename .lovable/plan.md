

## Plan: Enable AI Chat to Augment In-Progress Workouts

### What This Adds
The AI coach will be able to modify a workout that is currently in progress — adding exercises, adding sets to existing exercises, updating weight/reps, and swapping exercises — all through natural language commands.

### Architecture

The ActiveSession component owns workout state internally. To let the AI mutate it, we need a shared communication channel.

```text
User Chat Input
     │
     ▼
ChatContext (executeToolCall)
     │
     ▼
SessionController (new shared ref/callback system)
     │
     ▼
ActiveSession (state updates)
```

### Changes

**1. Create a Session Controller hook (`src/hooks/useSessionController.ts`)**
- Expose a ref-based API that the ChatContext can call into: `addExercise(exerciseId)`, `addSet(exerciseIndex)`, `updateSet(exerciseIndex, setIndex, { weight?, reps? })`, `swapExercise(exerciseIndex, newExerciseId)`, `removeExercise(exerciseIndex)`
- The ActiveSession registers its mutation callbacks on mount and unregisters on unmount
- Returns a `sessionRef` that ChatContext can invoke

**2. Update ChatContext (`src/contexts/ChatContext.tsx`)**
- Add new allowed actions to `AI_ALLOWED_ACTIONS`: `add_exercise_to_workout`, `add_sets_to_exercise`, `update_set_weight_reps`, `swap_exercise_in_workout`
- Add these to `ACTIONS_REQUIRING_EXERCISE_VALIDATION` where applicable
- Implement the `executeToolCall` cases that call into the session controller
- Pass active session state (current exercises, sets, weights) in `buildContext` when on the `active_workout` screen so the AI knows what's in the session
- Update the system prompt in the edge function to describe these new tools

**3. Update ActiveSession (`src/components/ActiveSession.tsx`)**
- Import and register with the session controller
- When the controller triggers `addExercise`, insert a new exercise block (same logic as the existing "Add Exercise" button)
- When `addSet` is called, append a set to the specified exercise block
- When `updateSet` is called, update weight/reps on the specified set
- When `swapExercise` is called, replace the exerciseId/name while preserving set data

**4. Update AI Coach Edge Function (`supabase/functions/ai-coach/index.ts`)**
- Add tool definitions for the new workout-mutation actions to the tools array
- Update system prompt to explain when to use these tools and the required parameters

**5. Validate all exercise references**
- All new workout actions that reference exercises go through the existing `validateExerciseReference` function — no new exercises can be created

### New Tool Definitions (for the edge function)

| Tool Name | Parameters | What It Does |
|---|---|---|
| `add_exercise_to_workout` | `exerciseId`, `sets` (default 3), `targetReps`, `weight` | Adds an exercise to the active session |
| `add_sets_to_exercise` | `exerciseIndex` or `exerciseName`, `count` (number of sets to add) | Adds sets to an existing exercise in the session |
| `update_set_weight_reps` | `exerciseName`, `setNumber`, `weight?`, `reps?` | Updates weight or reps on a specific set |
| `swap_exercise_in_workout` | `exerciseName` (current), `newExerciseId` | Replaces one exercise with another, keeping set structure |

### Files to Create/Edit
- **Create**: `src/hooks/useSessionController.ts` — shared ref-based controller
- **Edit**: `src/contexts/ChatContext.tsx` — add actions, wire controller, pass session context
- **Edit**: `src/components/ActiveSession.tsx` — register with controller
- **Edit**: `supabase/functions/ai-coach/index.ts` — add tool definitions and prompt updates
- **Redeploy**: `ai-coach` edge function

