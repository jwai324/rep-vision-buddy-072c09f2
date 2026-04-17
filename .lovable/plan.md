
## Fix Start/Stop set button toggle behavior

### Current bug
Tapping "Stop set" likely triggers the 5-second countdown overlay because the same handler (`handleStartNextSet`) is wired to both states, and its "if running, stop first then start next" logic always proceeds to launch the countdown for the next set.

### Fix
In `ActiveSession.tsx`, split the click behavior based on whether a set is currently running in this exercise block:

1. **If `runningSet` belongs to this block** → call `handleStopSet()` only. Record `endedAt`, write duration to `time`, auto-complete the set, start the rest timer. **Do NOT show countdown. Do NOT auto-advance.** Button reverts to "Start next set".

2. **If no set is running in this block** → start the 5s countdown for the next uncompleted set as today.

3. Remove the "stop current + start next in one tap" auto-chain. The user explicitly taps Stop, then taps Start again for the next set. (This also removes the "+5s bonus" logic, which only existed to compensate for the implicit chain.)

### Code change (single file)
- `src/components/ActiveSession.tsx`:
  - In the header button's `onClick`, branch:
    ```ts
    if (runningSet?.blockIdx === blockIdx) handleStopSet();
    else handleStartNextSet(blockIdx);
    ```
  - Inside `handleStartNextSet`, remove the "if running, stop first" branch — it should early-return (or no-op) if any set is currently running, since the button now reads "Stop set" in that state.
  - Keep the countdown overlay tied strictly to `handleStartNextSet`.

### Files touched
- `src/components/ActiveSession.tsx` (only)

### What stays the same
- Countdown overlay component, time formatting, persistence cache fields, rest timer behavior, auto-complete on stop.
