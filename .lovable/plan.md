

Let me check the session UI to find the right IDs and the exercise selector layout.
<lov-tool-use id="toolu_vrtx_019GUiFqNy6wyrJ3NyB61NkU" name="code--search_files" integration-id="code" data="{\"query\": \"tutorial-\", \"include_patterns\": \"src/**/*.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_018kQkT3VUmb1rofVzEqW1wV" name="code--search_files" integration-id="code" data="{\"query\": \"tutorial-\", \"include_patterns\": \"src/**/*.tsx\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01JUCJc8VeyTciYzeJRC6e3W" name="code--search_files" integration-id="code" data="{\"query\": \"ExerciseSelector|BrowseExercises\", \"include_patterns\": \"src/components/ActiveSession.tsx,src/components/ExerciseSelector.tsx\"}">
</lov-tool-use>
Now I understand. The flow: tap "Add Exercise" → opens `ExerciseSelector` modal → user picks an exercise → modal closes, set row appears. The tutorial step `tutorial-set-row` targets the first set row, but likely only re-measures when the step changes — not when the DOM appears. Also need to clarify "discard workout" — let me check.
<lov-tool-use id="toolu_vrtx_01LhowEKYpT3vcoqLVSWts6B" name="code--search_files" integration-id="code" data="{\"include_patterns\": \"src/components/ActiveSession.tsx\", \"query\": \"discard|Discard|cancel.*workout|Cancel\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01EbiDaGmqRqqZ5yWarXLEKL" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/TutorialOverlay.tsx\", \"lines\": \"25-75\"}">
</lov-tool-use>
I have everything needed. Two issues:

1. **Tutorial stops after exercise pick**: The `tutorial-set-row` element doesn't exist when the user opens the picker (step shows `skipIfMissing` advances), then after picking, the new set row appears but the overlay isn't re-measuring because `step` reference doesn't change. Need a MutationObserver / polling retry when target is missing but step is NOT marked `skipIfMissing`.

2. **Selecting workout overlay misalignment**: When the `ExerciseSelector` modal opens (full-screen overlay), the spotlight still targets `tutorial-add-exercise` which is now hidden behind the modal — alignment looks off. The tutorial should pause spotlight or skip while modal is open.

3. **No discard step**: Need to add discard tutorial step. There's already `setShowDiscardConfirm` button in ActiveSession.

<lov-plan>

## Fix tutorial: continue through set logging + discard, fix overlay alignment

### Issues
1. **Tutorial halts after picking exercise** — the `tutorial-set-row` step waits for an element that doesn't exist until the `ExerciseSelector` modal closes. Current overlay only measures once per step change, so the new set row never gets spotlighted.
2. **Overlay misaligned during exercise selection** — while the full-screen `ExerciseSelector` modal is open, the spotlight still highlights the (now-covered) "Add Exercise" button underneath, looking broken.
3. **Missing steps** — no guidance for entering weight/reps, and no walkthrough of discarding the workout at the end.

### Fix

**1. `TutorialOverlay.tsx` — retry until target appears**
- Replace one-shot `measure()` with a `MutationObserver` on `document.body` (subtree) plus a fallback interval (every 300ms, 30s timeout). When target appears, measure and stop observing.
- Skip auto-advance for non-`skipIfMissing` steps; instead show a centered "Waiting for…" tooltip until DOM appears.

**2. `TutorialContext.tsx` — extend SESSION_STEPS**
- Insert between current "Add Exercises" and "Log a Set":
  - New step (no target, centered): "Pick an Exercise" — "Choose any exercise from the library and tap it to add it to your workout."
- Add new steps after "Complete the Set":
  - `tutorial-weight-input` — "Enter Weight" — "Tap the weight cell and use the keypad to log the load you lifted." (target first set's weight input)
  - `tutorial-reps-input` — "Enter Reps" — "Then enter how many reps you completed."
- Add new step after "Finish Workout":
  - `tutorial-discard-btn` — "Or Discard" — "Started a workout by mistake? Tap Discard to throw it away without saving."

(Reorder so logical flow is: Add Exercise → Pick Exercise → Set Row → Weight → Reps → RPE → Complete Set → Finish → Discard.)

**3. `ActiveSession.tsx` — add new IDs**
- `id="tutorial-weight-input"` on first set's weight input (mirror existing `tutorial-rpe` pattern: `blockIdx === 0 && setIdx === 0`).
- `id="tutorial-reps-input"` on first set's reps input.
- `id="tutorial-discard-btn"` on the Discard button at line 1477.

**4. Hide overlay while modals are open (alignment fix)**
- In `TutorialOverlay.tsx`, detect when a Radix dialog is open by checking for `[role="dialog"][data-state="open"]` in the DOM during measure. If found AND current step's target is not inside it, hide the spotlight (render only the centered tooltip with backdrop) until modal closes. The MutationObserver from fix #1 already triggers re-evaluation.

### Files
- Modify: `src/components/TutorialOverlay.tsx`, `src/contexts/TutorialContext.tsx`, `src/components/ActiveSession.tsx`

### Validation
- Replay tutorial → reach Add Exercise → tap → picker opens, tutorial shows "Pick an Exercise" centered (no misaligned spotlight) → pick exercise → picker closes → spotlight smoothly snaps to first set row → walk through weight, reps, RPE, complete, finish, discard → tutorial ends.

