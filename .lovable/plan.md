

## Plan: Drag-and-Drop Exercise Reordering

### Overview
Replace the "Move Up / Move Down" menu buttons with press-and-hold drag-to-reorder for exercise blocks in both the Template Builder and Active Session.

### Approach
Use `@dnd-kit/core` and `@dnd-kit/sortable` — the standard React drag-and-drop library that supports both mouse and touch (long-press) interactions.

### Changes

**1. Install dependency**
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`

**2. Create a reusable `DraggableExerciseBlock` wrapper** (`src/components/DraggableExerciseBlock.tsx`)
- Uses `useSortable` from dnd-kit
- Renders a drag handle (grip icon) on the left side of the exercise header
- Long-press activates drag on touch devices via dnd-kit's `TouchSensor` with `activationConstraint: { delay: 250, tolerance: 5 }`

**3. Update `src/components/TemplateBuilder.tsx`**
- Wrap exercise list in `DndContext` + `SortableContext` (vertical list strategy)
- Each exercise block becomes a `SortableItem`
- On `onDragEnd`, call existing `moveExercise(oldIndex, newIndex)`
- Remove "Move Up" / "Move Down" buttons from the popover menu

**4. Update `src/components/ActiveSession.tsx`**
- Add a `moveExercise` callback (same pattern as TemplateBuilder)
- Wrap exercise blocks in `DndContext` + `SortableContext`
- Each block becomes sortable with a drag handle
- Remove any move-related menu items if present

**5. Visual feedback**
- Dragged item gets a subtle scale + shadow overlay via dnd-kit's `DragOverlay`
- Drop placeholder shown between items

### Technical Details
- `MouseSensor` with `activationConstraint: { distance: 8 }` for desktop
- `TouchSensor` with `activationConstraint: { delay: 200, tolerance: 5 }` for mobile long-press
- `arrayMove` utility from `@dnd-kit/sortable` handles the reorder logic
- `restrictToVerticalAxis` modifier keeps drag locked to Y-axis

