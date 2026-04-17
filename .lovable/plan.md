
## Stop rest timer after 5s countdown completes (not when button tapped)

### Behavior
- Tap **Start next set** → 5s countdown overlay appears, rest timer **keeps ticking** during the countdown.
- Countdown completes → rest timer stops and records actual elapsed time (including any overtime).
- Countdown **cancelled** → rest timer was never stopped, continues normally.

### Change (single file: `src/components/ActiveSession.tsx`)

The countdown overlay's `onComplete` handler already fires when the 5s reaches zero and transitions into starting the next set. We hook `skipTimer()` there — not in `handleStartNextSet`.

- **`handleStartNextSet`**: unchanged — only opens the countdown overlay. Rest timer keeps running.
- **Countdown `onComplete` handler**: call `skipTimer()` immediately before starting the new set. This stops the previous rest timer and records actual elapsed seconds (including overtime accrued during the 5s lag).
- **Countdown `onCancel` handler**: do nothing to the rest timer — it continues uninterrupted.

### Files touched
- `src/components/ActiveSession.tsx` (countdown completion handler only)

### Unchanged
- `skipTimer` recording logic, overtime display, Stop Set behavior, countdown overlay component.
