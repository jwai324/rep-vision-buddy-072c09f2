
## Show active rest timer in Focus Mode

Add a floating timer pill fixed to the bottom-right of the Focus Mode overlay. It displays the remaining rest time with a circular progress ring, plus Skip and +30s controls.

### Changes

**`src/components/FocusMode.tsx`**:

1. Import `Timer` icon from lucide-react, add `useCallback` to the React import.
2. Add a `useTimerRemaining` hook (local to the file) that reads `props.activeTimer` and ticks every second to compute `remaining` and `progress`.
3. Render a floating pill (`fixed bottom-6 right-4 z-[55]`) when `activeTimer` is active and `remaining > 0`:
   - Small circular SVG progress ring (40px) with the remaining time in `mm:ss`.
   - Skip and +30s buttons below.
4. The pill uses the same design tokens as `RestTimerRing` (primary stroke, surface background) but in a compact format suitable for a floating overlay.
