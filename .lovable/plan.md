

## Plan: Full-Width Progress Bar Rest Timer Between Sets

### Problem
The "between sets" rest timer currently renders as a small centered circular ring, leaving large blank horizontal spaces between set rows.

### Solution
Replace the circular ring with a **full-width horizontal progress bar** that fills left-to-right across the entire row. The timer text, Skip and +30s buttons sit centered on top of the bar.

### Changes

**`src/components/ExerciseRestTimer.tsx`** — `variant === 'between'` active state only (~20 lines)

- Replace the SVG circle + centered layout (lines 74–104) with a full-width container:
  - A background bar (`bg-secondary/30`, full width, rounded, ~8px tall)
  - An inner fill bar (`bg-primary`) that grows from `width: 0%` to `width: 100%` based on `progress`, with a smooth CSS transition
  - Timer text, "Rest" label, Skip and +30s buttons overlaid in a row on top
- Inactive states (Start Rest button, recorded rest pill) stay the same — they're already compact
- The recorded rest state could also become a subtle full-width bar showing the completed time, but keep it as-is for now

**No other files change.**

