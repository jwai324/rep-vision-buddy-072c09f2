
## Require Long-Press to Reorder Exercises (Mobile)

### Problem
Currently the TouchSensor uses `delay: 200ms, tolerance: 5px` — short enough that a normal vertical scroll/swipe can accidentally pick up an exercise and start reordering it instead of scrolling the page.

### Fix
Increase the touch activation threshold so the user must intentionally press-and-hold the drag handle before reordering kicks in.

**`src/components/ActiveSession.tsx` (line 791-794)** — adjust the `TouchSensor` activation constraint:
- `delay: 200` → `delay: 500` (true long-press)
- `tolerance: 5` → `tolerance: 8` (allow finger micro-movement during the hold without canceling)

This means: a quick swipe up/down scrolls the page as expected; only a deliberate ~half-second press on the grip handle starts a drag.

### What stays the same
- `PointerSensor` (desktop mouse) keeps its 8px distance activation — desktop unchanged.
- Drag handle, visuals, drop animation, `restrictToVerticalAxis` modifier — all unchanged.
- `SortableExerciseItem` component untouched.
