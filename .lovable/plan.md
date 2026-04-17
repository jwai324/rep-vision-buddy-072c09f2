

## Fix Floating "Add N Exercises" Button + Horizontal Scroll

### Problem
1. **Button scrolls away**: In `ActiveSession.tsx` line 1061, the exercise picker wrapper uses `min-h-screen flex flex-col`. `min-h-screen` lets the page grow taller than the viewport, so the entire page scrolls — and the "Add N Exercises" button (which uses `sticky bottom-0` inside `ExerciseSelector`) ends up pinned to the bottom of the long content, not the viewport.
2. **Slight horizontal scroll**: The outer wrapper has no `overflow-x-hidden` / `min-w-0`, so wide content (long exercise names, filter chip rows) can push the page sideways on mobile.

### Fix (two small edits)

**`src/components/ActiveSession.tsx` (lines 1059-1067)** — make the picker viewport-locked:
- Change wrapper to `h-screen flex flex-col overflow-hidden` (use `h-dvh` fallback via `h-[100dvh]` for mobile browser chrome).
- Add `min-w-0` so children can't overflow horizontally.

This makes `ExerciseSelector` (which already uses `h-full` + `flex flex-col` with `ScrollArea flex-1`) properly scroll only its inner list, leaving the bottom action bar fixed at the viewport bottom.

**`src/components/ExerciseSelector.tsx` (bottom button block, ~line 333)** — promote the action bar from `sticky` to a real flex-bottom child (it's already a sibling of the ScrollArea, so removing `sticky bottom-0` and keeping `border-t p-4 bg-background` is enough). Also ensure the outer `<div>` already has `overflow-x-hidden` (it does) — no change needed there.

### What stays the same
- All filter UI, exercise list rendering, multi-select logic, create-custom-exercise flow.
- `ExerciseSelector`'s public API.
- Desktop behavior (already correct since the desktop layout has explicit height constraints).

