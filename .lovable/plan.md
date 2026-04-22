

## Auto-close exercise three-dots menu on selection

### Problem
The three-dots (`...`) Popover menu on each exercise block in an active session stays open after selecting an action.

### Fix

**`src/components/ActiveSession.tsx`** — in the `ExerciseTable` component:

1. Add a `useState<boolean>(false)` for `menuOpen` to control the Popover's open state.
2. Pass `open={menuOpen}` and `onOpenChange={setMenuOpen}` to the `<Popover>` component (line 2165).
3. In the menu item `onClick` handler (line 2175), close the popover before calling the action:
   ```tsx
   onClick={() => {
     setMenuOpen(false);
     onMenuAction(item.label, blockIdx);
   }}
   ```

This ensures the menu dismisses immediately when any option is tapped.

### Files
- Modify: `src/components/ActiveSession.tsx`

