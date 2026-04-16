
## Fix Horizontal Scroll on Exercise Screen (Mobile)

### Problem
On mobile, the exercise selector screen scrolls horizontally. Likely culprit: the body part chip row (`overflow-x-auto`) combined with filter chips and possibly the exercise list cards causing overflow.

### Investigation needed
Confirm exact cause by checking `ExerciseSelector.tsx` layout and any parent container constraints.

### Likely fixes in `src/components/ExerciseSelector.tsx`
1. **Quick body part chip row** (currently `overflow-x-auto` horizontal scroller): change to wrapped chips (`flex-wrap`) so they stack onto multiple lines instead of forcing horizontal scroll. This matches the design used inside the filter panel.
2. **Container hardening**: add `min-w-0` / `max-w-full` / `overflow-x-hidden` to the root flex container so no child can force the screen wider than the viewport.
3. **Exercise card rows**: ensure the inner text container uses `min-w-0` and long names truncate (`truncate`) so very long exercise names don't push width.

### Files
- `src/components/ExerciseSelector.tsx` — replace horizontal scroller with wrapping chips, add overflow guards, truncate long names.

### What stays the same
- All filtering, search, multi-select, and create-custom behavior unchanged.
- Filter panel layout unchanged.
- Desktop layout unaffected (wrapping chips look identical when there's room).
