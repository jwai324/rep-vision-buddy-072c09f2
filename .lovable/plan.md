

## Restore drag-to-reorder while keeping scroll safe

### How it's supposed to work
On the active workout screen each exercise has a grip handle (`⋮⋮` icon) on its left. To reorder:
- **Mobile:** press-and-hold the grip for ~500ms, then drag up/down. A short tap or swipe scrolls the page normally.
- **Desktop:** click the grip and drag at least 8px.

### Why it broke
Last change removed `touch-none` from the grip to fix accidental drags while scrolling. That fixed scrolling, but it also means the browser now claims the touch for scrolling even after the 500ms long-press fires — so the drag never starts on mobile.

The right fix is: let scroll work everywhere on the row EXCEPT once a long-press has been recognized on the grip itself. dnd-kit's `TouchSensor` with `delay` already gates activation; we just need the grip to opt out of native touch-scrolling so that after the delay the drag can take over. The previous attempt put `touch-none` on the button always — that's too aggressive on a small target where the thumb often lands while scrolling.

### Fix (1 file: `src/components/SortableExerciseItem.tsx`)
1. Put `touch-action: none` back on the grip button — but enlarge the touch target slightly (`p-2` instead of `p-1`) and keep it visually the same, so users land on it intentionally.
2. Verify (no change needed if already correct) that `ActiveSession.tsx` `TouchSensor` uses `{ delay: 500, tolerance: 8 }` — that's what prevents an accidental tap-on-grip from triggering a drag during a scroll. If a quick swipe starts on the grip, the 8px tolerance cancels activation and the page scrolls.

Net effect: scrolling anywhere on the row (including a quick brush over the grip) still scrolls; a deliberate long-press on the grip starts the drag.

### What stays the same
- `ActiveSession.tsx` sensor config and reorder logic.
- All other touch behavior (set rows, swipe-to-delete).

