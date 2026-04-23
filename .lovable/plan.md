

## Add "Hide Timers" toggle to workout three-dot menu

### Change

Add a toggle option in the workout-level three-dot menu (top-right `MoreVertical`) that hides all rest timers — both between exercises and between sets. When hidden, the timer UI elements are not rendered. An active timer continues running but the visual is suppressed. Default state: timers visible.

### Implementation

**`src/components/ActiveSession.tsx`**:

1. Add state: `const [hideTimers, setHideTimers] = useState(false);`

2. In the workout three-dot menu Popover (lines 1463-1471), add a second menu item with a toggle:
   ```tsx
   <button
     onClick={() => setHideTimers(prev => !prev)}
     className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors text-foreground"
   >
     <Timer className="w-4 h-4" />
     {hideTimers ? 'Show Timers' : 'Hide Timers'}
   </button>
   ```

3. Wrap the between-exercise `ExerciseRestTimer` (line 1664-1677) with `{!hideTimers && blockIdx > 0 && (`.

4. Wrap the between-set `ExerciseRestTimer` (line 2561-2579) with a `hideTimers` check — render `null` when `hideTimers` is true.

5. Pass `hideTimers` to `ExerciseTable` as a prop so the between-set timers inside it can also be hidden. Add it to the `ExerciseTable` component's props interface and use it to conditionally render the between-set timer block.

### Files
- Modify: `src/components/ActiveSession.tsx`

