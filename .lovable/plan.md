

## Fix tutorial: header overflow on mobile + Back navigates screens

### Issue 1: Finish/Discard highlight wrong area
At 384px viewport, the session header (back + 3-dot + Focus + Discard + Finish) overflows horizontally. The Discard/Finish buttons sit off-screen, so `getBoundingClientRect()` returns coordinates outside the viewport — the spotlight ring + dim panels render at those off-screen coords, looking like a random/wrong highlight.

**Fix:** Before measuring, scroll the target's nearest scrollable ancestor (or `scrollIntoView({ inline: 'nearest' })`) so the button enters the viewport. Already calling `scrollIntoView` but with `inline: 'center'` — on a horizontally overflowing flex row this doesn't reliably work because the parent isn't scrollable. Real fix is to wrap the header right-side actions in an `overflow-x-auto` container so the spotlight scroll works, OR make the header wrap on mobile.

Cleanest: in `ActiveSession.tsx` line 1452, change `<div className="flex items-center gap-2">` to `<div className="flex items-center gap-2 flex-wrap justify-end">` so buttons wrap to a second row on narrow screens and remain on-screen. Also reduce header padding to `px-3` on mobile if needed.

### Issue 2: Back button doesn't navigate screens
`prev()` in `TutorialContext` only decrements step index. When stepping back across a `screen` boundary (e.g., from `activeSession` step back into `startWorkout` or `dashboard`), the user remains on the active session screen while the overlay points at a non-existent target → looks broken/stuck.

**Fix:** In `TutorialContext.tsx`, expose an `onScreenBack` callback (similar to existing `onComplete`). When `prev()` would cross a screen boundary (new step's `screen` differs from current step's `screen`), invoke `onScreenBack(targetScreen)` so `Index.tsx` can `setScreen(...)` back to the appropriate page.

Wire in `Index.tsx`:
- Pass `onScreenBack={(screen) => { if (screen === 'dashboard') setScreen({type:'dashboard'}); else if (screen === 'startWorkout') setScreen({type:'startWorkout'}); }}` to `TutorialProvider`.
- Note: going back from `activeSession` to `startWorkout` shouldn't actually discard the workout — instead, minimize it (call existing minimize handler) so the session is preserved.

### Files
- Modify: `src/components/ActiveSession.tsx` (header wrap), `src/contexts/TutorialContext.tsx` (prev with screen-back callback), `src/pages/Index.tsx` (wire callback).

### Validation
- 384px viewport → reach Finish/Discard steps → spotlight aligns precisely on the buttons (now wrapped to second row).
- During session steps, tap Back repeatedly → tour walks back AND the page navigates back through StartWorkout → Dashboard, with the active session minimized rather than discarded.

