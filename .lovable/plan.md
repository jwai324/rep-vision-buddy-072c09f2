
## Problem

On iOS Safari, tapping into a form input with a font size smaller than 16px triggers an automatic zoom-in. Safari does not zoom back out when the input loses focus, leaving the page stuck in a zoomed state.

All workout input fields (weight, reps, distance, etc.) in `ActiveSession.tsx` use `text-sm` (14px), which is below the 16px threshold.

## Solution

Two changes:

### 1. Update `index.html` viewport meta tag

Add `maximum-scale=1` to the viewport meta tag to prevent iOS Safari from zooming on focus. This is a well-known workaround used by most mobile-first web apps.

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
```

### 2. Bump input font size to 16px (belt-and-suspenders)

Change all workout set-row `<input>` and `<select>` elements from `text-sm` (14px) to `text-base` (16px). This ensures iOS never triggers the zoom behavior regardless of the viewport setting. Affected inputs are in the `ExerciseTable` render methods for all six measurement modes (reps, weight, distance, time, band, drops).

This also applies to the note textarea and location/timer selects in the session header area.

### Files changed
- `index.html` — viewport meta tag
- `src/components/ActiveSession.tsx` — `text-sm` to `text-base` on all focusable inputs/selects in set rows and drop rows
