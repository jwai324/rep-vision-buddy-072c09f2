

## Fix: auto-advance check is short-circuited

### Root cause
In the `MutationObserver` effect:
```
const open = !!document.getElementById('tutorial-exercise-picker-root');
if (open === pickerOpenRef.current) return;  // ← bails out
```
When user taps Finish, picker state hasn't changed (still closed), so `check()` returns immediately — the `tutorial-finish-btn → tutorial-save-workout` branch below never executes.

### Fix
**`src/contexts/TutorialContext.tsx`** — restructure the `check()` function so the early-return only guards the picker-specific branches, not the summary-appearance branch.

Approach: track summary-open state with its own ref (`summaryOpenRef`), and check it independently. Only return early when nothing relevant changed.

```ts
const pickerOpenRef = useRef(false);
const summaryOpenRef = useRef(false);

const check = () => {
  const pickerOpen = !!document.getElementById('tutorial-exercise-picker-root');
  const summaryOpen = !!document.getElementById('tutorial-save-workout');
  const pickerChanged = pickerOpen !== pickerOpenRef.current;
  const summaryChanged = summaryOpen !== summaryOpenRef.current;
  if (!pickerChanged && !summaryChanged) return;
  pickerOpenRef.current = pickerOpen;
  summaryOpenRef.current = summaryOpen;

  const current = steps[index];
  if (!current) return;

  if (pickerChanged && pickerOpen && current.targetId === 'tutorial-add-exercise') {
    setIndex(i => Math.min(steps.length - 1, i + 1));
  } else if (pickerChanged && !pickerOpen && current.screen === 'activeSession' && !current.targetId && current.title.startsWith('Pick')) {
    setIndex(i => Math.min(steps.length - 1, i + 1));
  } else if (summaryChanged && summaryOpen && current.targetId === 'tutorial-finish-btn') {
    setIndex(i => Math.min(steps.length - 1, i + 1));
  }
};
```

### Files
- Modify: `src/contexts/TutorialContext.tsx`

### Validation
At 384px: reach Finish step → tap Finish → summary opens → spotlight auto-advances to bottom "Save Workout" button without manual Next.

