
## Rest timer: count into overtime, record actual elapsed

### Behavior
- Rest timer counts down to 0:00, then flips to **"Overtime 0:12"** (counting up positive) until the user starts the next set or skips.
- When stopped (next set started or skip pressed), the **recorded rest = actual total elapsed time** (planned duration + overtime, or less if skipped early).

### Changes

**`src/hooks/useRestTimer.ts`**
- Remove `Math.max(0, ...)` clamp on `remaining` — allow it to go negative internally.
- Remove the auto-stop branch at `<= 0`. Timer keeps ticking.
- `progress` capped at 1 for ring/bar visuals.
- `skip()` returns the actual elapsed seconds: `totalDurationRef.current - remaining` (so callers can record it).
- Expose `elapsed` derived value for display: `totalDuration - remaining` (always positive once overtime).

**`src/components/ExerciseRestTimer.tsx`**
- When `remaining >= 0` → existing `m:ss` countdown display.
- When `remaining < 0` → render **"Overtime M:SS"** using `Math.abs(remaining)`, switch text/bar color to `text-destructive` / amber accent.
- Inline variant: same overtime label, smaller. Keep `animate-pulse`.
- "Recorded rest" pill (post-stop) shows the actual total elapsed time returned from skip.

**`src/components/RestTimerRing.tsx`**
- Same overtime treatment: ring stays full, color flips to destructive, label reads `Overtime M:SS`.

**`src/components/ActiveSession.tsx`**
- In `handleStartNextSet`: before launching the 5s countdown, if a rest timer is active call `skip()` and capture returned elapsed seconds → store as the recorded rest for the just-completed set.
- Skip button path already calls `skip()` — same recording flow.

### Files touched
- `src/hooks/useRestTimer.ts`
- `src/components/ExerciseRestTimer.tsx`
- `src/components/RestTimerRing.tsx`
- `src/components/ActiveSession.tsx`

### Unchanged
- Rest trigger points, default durations, persistence, layout.
