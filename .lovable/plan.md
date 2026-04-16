

## Persistent, Timestamp-Based Rest Timer

### Goal
Refactor the rest timer in `ActiveSession.tsx` so it survives backgrounding, screen lock, app kill, and reload. Logic only — no UI changes.

### Current problems
- Uses `performance.now()` for the timer anchor → resets/drifts when the tab is suspended or killed.
- `activeTimer` lives only in React state — not persisted, lost on reload.
- No completion catch-up: if the timer finished while the app was closed, no completion event fires.
- No background notification.

### Architecture

**1. Timestamp model (no ticking source of truth)**
Persisted record shape:
```ts
type TimerStatus = 'running' | 'paused' | 'completed';
interface PersistedTimer {
  id: TimerId;                  // existing { type, blockIdx, setIdx? }
  startedAtEpoch: number;       // Date.now() when (re)started; 0 when paused
  duration: number;             // seconds remaining when this run started
  originalDuration: number;     // for progress ring math
  status: TimerStatus;
  elapsedAtPause?: number;      // seconds elapsed before pause
  notificationId?: number;      // for cancel
}
```
Remaining is always derived: `remaining = max(0, (startedAtEpoch + duration*1000 - Date.now())/1000)`. `setInterval` only triggers re-render every 1s; it is never the source of truth.

**2. Live inside the workout cache (one source of truth)**
Extend `ActiveSessionCache` with `activeTimer: PersistedTimer | null` and `restRecords: Record<string,number>`. Saved on start/skip/extend/pause/resume/complete via the existing cache `useEffect`. UI reads from this single record.

**3. Hydration & reconciliation**
On mount (after `cachedSession` load):
- If `activeTimer` exists and `status==='running'`:
  - Compute `remaining`. If `<= 0` → mark completed, push to `restRecords[timerIdKey]` with `originalDuration`, clear `activeTimer`, fire one-time toast "Rest complete".
  - Else → resume countdown by setting state from the persisted record.
- If `paused` → restore paused UI with `elapsedAtPause`.

**4. Background completion notification**
Use the Web Notifications API (works while tab is alive in background / phone locked with PWA installed). Schedule via `setTimeout(duration*1000)` AND store a fallback target epoch. On start: request permission once, schedule. On skip/cancel/extend: clear timeout & reschedule. On hydration after kill: if past the target → fire immediately ("Rest finished while you were away"). 
Add a comment that for true app-killed delivery, Capacitor `@capacitor/local-notifications` is required (out of scope unless user adds Capacitor) — graceful no-op when Notifications API unavailable.

**5. Pause / resume**
- Pause: `elapsedAtPause = originalDuration - remaining`, `status='paused'`, clear timeout, set `startedAtEpoch=0`. Persist.
- Resume: `startedAtEpoch = Date.now()`, `duration = originalDuration - elapsedAtPause`, `status='running'`, reschedule notification. Persist.
(Current UI has no pause control for the rest timer; we add the logic so it's available, but expose nothing new visually — existing Skip / ±30s buttons unchanged.)

**6. Edge cases**
- **Clock change**: on `visibilitychange→visible` and on `window` `focus`, recompute remaining from `Date.now()`. If clock jumped backward making remaining > originalDuration, clamp to originalDuration. If forward past completion, complete.
- **Storage write failure**: wrap each `localStorage.setItem` in try/catch + `console.warn`; never throw.
- **Extend (±30s)**: mutate `originalDuration` and `duration` in the persisted record, reschedule notification.
- **Multiple tabs**: listen to `storage` event for `CACHE_KEY` and re-hydrate so a second tab stays in sync.
- **Completion fires once**: guard with a `completedFiredFor` ref keyed by `timerIdKey(id)+startedAtEpoch`.

### Files

**Modify `src/components/ActiveSession.tsx`**
- Replace `activeTimer` state shape with `PersistedTimer | null`.
- Replace `performance.now()` with `Date.now()` everywhere in timer math.
- Add hydration `useEffect` reading `cachedSession.activeTimer` + `restRecords`.
- Extend `ActiveSessionCache` interface (add `activeTimer`, `restRecords`).
- Update cache-write `useEffect` to include them.
- Rewrite `startTimer`, `skipTimer`, `extendTimer`; add `pauseTimer`, `resumeTimer`.
- Add `scheduleNotification`/`cancelNotification` helpers (Web Notifications + setTimeout).
- Add `visibilitychange` + `focus` + `storage` listeners that call `recalcRestTimer()`.
- Wrap localStorage writes in try/catch.

**Modify `src/components/ExerciseRestTimer.tsx`**
- No visual change. Only: `remaining` may now be derived from `Date.now()` upstream (already a prop). No edits required unless we want to expose pause; keep interface unchanged.

**No changes** to `useRestTimer.ts` (unused by ActiveSession; left as-is for now).

### What stays the same
- All visuals, button layouts, classNames, icons, animations.
- `ExerciseRestTimer` props and `TimerId` shape.
- `restRecords` keying via `timerIdKey`.
- Workout cache key (`active-session-cache`) — only the payload grows (back-compat: missing `activeTimer` → null).

