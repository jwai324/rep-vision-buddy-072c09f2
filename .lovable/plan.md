

## Plan: Background-Safe Timers with Timezone-Aware Timestamps

### Problem
Rest countdown timers and the workout elapsed timer use `setInterval` to tick every second. Browsers throttle or pause intervals when the tab is hidden or the screen turns off, causing timers to freeze and display incorrect values on return.

Additionally, using `Date.now()` without care can introduce drift if the device clock changes (e.g., crossing a timezone boundary or DST transition mid-workout). We need monotonic-safe timestamps.

### Changes

**1. `src/hooks/useRestTimer.ts` — Timestamp-based rest countdown**
- Store a `startedAt` ref (`Date.now()`) and `totalDuration` ref when `start()` is called.
- On each interval tick, compute `remaining = Math.max(0, totalDuration - Math.floor((Date.now() - startedAt) / 1000))` instead of decrementing.
- `extend()` adds to `totalDuration` without changing `startedAt`.
- Add a `visibilitychange` listener that forces an immediate recalculation when the page returns to the foreground.
- Use `performance.now()` for elapsed measurement where possible (monotonic, immune to clock/timezone changes), falling back to `Date.now()` delta for the timestamp anchor.

**2. `src/components/ActiveSession.tsx` — Workout elapsed timer**
- The elapsed timer already uses `Date.now() - startTime.current`, which is timestamp-based.
- Add a `visibilitychange` listener to force an immediate `setElapsed` recalculation on tab focus so the display updates instantly.
- For the inline rest timer (lines ~264–311), apply the same timestamp approach: store `restStartedAt` and `restDuration`, compute remaining on each tick from the timestamp delta.

**3. Timezone / clock-change safety**
- Use `performance.now()` deltas (monotonic clock) for all in-session elapsed calculations. This is immune to timezone changes, DST transitions, and manual clock adjustments.
- Only use `Date.now()` for the session's absolute start timestamp (stored for history/logging), not for computing durations.
- On `visibilitychange`, recalculate using the same `performance.now()` anchor so returning from background after a timezone shift doesn't break anything.

### What stays the same
- All timer UI components (`ExerciseRestTimer`, `RestTimerRing`, `MinimizedSessionBar`) — they receive `remaining`/`progress` as props, no changes needed.
- Session caching, pause/resume logic, and all other features.

