

## Fix accidental drag when scrolling in active workout

### Cause
`src/components/SortableExerciseItem.tsx` uses `useSortable` from `@dnd-kit/sortable` and spreads `listeners` only on the grip handle button — that part is correct. But the underlying DnD sensors in `ActiveSession.tsx` are almost certainly configured with default `PointerSensor` / `TouchSensor` with no activation constraint, so any touch on the grip (or any element if listeners leaked) starts a drag immediately. On mobile, when the user's thumb lands on or near the grip while starting a vertical scroll, the drag wins over the scroll.

The fix is to require either a small delay or a movement threshold before activating drag, so a quick scroll gesture never triggers reordering.

### Fix (single file: `src/components/ActiveSession.tsx`)
Locate the `useSensors(...)` call and configure activation constraints:

- `PointerSensor` → `activationConstraint: { distance: 8 }` (mouse must move 8px before drag starts).
- `TouchSensor` → `activationConstraint: { delay: 200, tolerance: 8 }` (finger must hold ~200ms with <8px movement; any earlier movement is treated as scroll).

If sensors aren't currently customized (using defaults via `DndContext`), add an explicit `useSensors` setup with `PointerSensor` and `TouchSensor` and pass it to `DndContext`.

### Optional polish
- Keep `touch-none` on the grip button so once drag activates, the browser doesn't also try to scroll.
- No changes needed to `SortableExerciseItem.tsx`.

### What stays the same
- Drag-and-drop reorder logic, set rendering, swipe-to-delete on sets.
- Desktop behavior (8px distance is imperceptible for mouse users).

