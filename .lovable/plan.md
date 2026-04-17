
## Stop horizontal scroll on Consistency (Streaks) tab

### Cause
The Consistency tab (`ConsistencyTab.tsx`) likely renders a wide element (calendar heatmap or weekly chart) that overflows the 384px mobile viewport. Even though `AnalyticsScreen` wraps `TabsContent` with `overflow-hidden`, the inner card or chart can still force layout width if it has a fixed min-width or wide grid.

Need to inspect the file to confirm the exact overflow source before fixing.

### Plan
1. Read `src/components/analytics/ConsistencyTab.tsx` to identify the wide element.
2. Apply width constraints:
   - Add `min-w-0 max-w-full overflow-hidden` to the outer card wrapper.
   - If a grid/heatmap has a min cell size pushing total width past 384px, reduce cell size on mobile (e.g. shrink from `w-6` to `w-4`, or use `aspect-square` with `grid-cols-N` that fits the viewport).
   - If a chart uses `ResponsiveContainer`, ensure its parent has `min-w-0` so it measures the constrained width.
3. If the chart still feels cramped after constraint, reduce its height slightly on mobile (e.g. `h-48` → `h-40`) so the proportions still read well.

### Files touched
- `src/components/analytics/ConsistencyTab.tsx` (only)

### What stays the same
- All data calculations, streak logic, other tabs.
