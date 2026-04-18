
## Fix missing rest day on the 17th

### Likely root cause
This looks like a UI logic mismatch, not an access-control problem:
- The dashboard can already infer scheduled rest/workout days from the active program.
- But when a day is tapped, `Index.tsx` currently routes mostly by “past vs future”.
- If that date has no completed session yet, the app can land on an empty History view even though the active program says it is a rest day.
- There is also a separate date bug: AI-created programs use UTC-style `toISOString().split('T')[0]`, which can shift the program start date by 1 day and throw off Day 1/Day 2 alignment.

### Plan
1. **Use local-date helpers only**
   - Add a shared local `yyyy-MM-dd` formatter in `src/utils/dateUtils.ts`.
   - Replace UTC date defaults used when creating programs so program start dates always match local calendar days.

2. **Fix day-click routing**
   - In `src/pages/Index.tsx`, when a calendar day is tapped, determine:
     - does it have a completed session?
     - does it have a stored scheduled entry in `futureWorkouts`?
     - does the active program define a scheduled day/rest day for that date?
   - If there is a scheduled item and no completed session, route to the scheduled view instead of empty History.

3. **Add active-program fallback**
   - If the clicked date is defined by the active program but missing from `futureWorkouts`, synthesize a temporary `FutureWorkout` in memory and open its detail view.
   - For rest days this should show:
     - `templateId: 'rest'`
     - `label: 'Rest Day'`
     - correct `date`
     - active program id

4. **Keep completion precedence**
   - If the user already logged that date, continue showing History first.
   - Only use the scheduled fallback when nothing has been completed yet.

### Files
- Modify `src/utils/dateUtils.ts`
- Modify `src/pages/Index.tsx`
- Reuse or extract the active-program scheduling logic currently mirrored in `src/components/Dashboard.tsx`
- Modify `src/components/AIProgramBuilder.tsx`
- Modify `src/contexts/ChatContext.tsx`

### Technical details
- No database migration needed.
- No RLS changes needed.
- This is a display/routing fix plus a local-date correctness fix.
- Result: tapping the 17th will show the expected rest day even if no completed session exists yet, and newly created programs will stop drifting by a day.

### Validation
- Tap the 17th and confirm the rest day appears.
- Confirm a completed rest day still opens from History.
- Create/save a new AI-generated program and verify Day 1/Day 2 align correctly with local dates.
