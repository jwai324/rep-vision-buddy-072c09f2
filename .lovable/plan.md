

## Stop accidental drag while scrolling on mobile

### What's happening
With `touch-none` on the grip button, dnd-kit's `TouchSensor` (delay 500ms, tolerance 8px) starts watching the moment a finger lands on the grip. If the user begins scrolling within that 500ms window and moves more than 8px, activation should cancel — but because the button has `touch-action: none`, the browser never starts a native scroll either. The result: a finger that lands on the grip during a scroll gets "stuck" and ends up dragging the exercise (as the session replay confirms — `ab-crunch-machine` was dragged over `cable-crunch` right before the complaint).

The grip is a small target on a 384px viewport, but thumbs landing on it during a swipe is common enough to be the dominant failure mode.

### Fix (1 file: `src/components/SortableExerciseItem.tsx`)
Replace the always-on `touch-none` with `touch-action: pan-y` on the grip button:

- `pan-y` tells the browser: "vertical scrolling is allowed here, everything else is mine."
- A vertical scroll gesture starting on the grip is handed to the browser immediately — no accidental drag.
- A long-press (no movement for 500ms) still fires the `TouchSensor` activation, and once dnd-kit takes over the pointer, the drag proceeds normally (dnd-kit calls `preventDefault` on subsequent moves).
- Horizontal drift during reorder is fine because dnd-kit owns the pointer by then.

Concretely, change the button className from:
```
... cursor-grab active:cursor-grabbing touch-none
```
to:
```
... cursor-grab active:cursor-grabbing [touch-action:pan-y]
```

Keep the enlarged `p-2 -m-1` hit area.

### Why this is the right balance
| Behavior | `touch-none` (now) | `pan-y` (fix) |
|---|---|---|
| Long-press grip → drag | works | works |
| Vertical scroll starting on grip | gets stuck → accidental drag | scrolls cleanly |
| Tap grip without moving | no-op | no-op |

### What stays the same
- `ActiveSession.tsx` sensor config (delay 500 / tolerance 8).
- All other touch behavior (set rows, swipe-to-delete, set inputs).
- Desktop drag (uses `PointerSensor`, unaffected by `touch-action`).

