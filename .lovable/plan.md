

## Fix Analytics horizontal scroll + add landscape rotation hint

### Part 1 — Stop horizontal scroll on mobile

**Cause:** The outer `AnalyticsScreen` wrapper (`min-h-screen p-4 flex flex-col`) has no `overflow-x-hidden` and no `min-w-0` guards. Several children can push width past 384px:
- `Tabs` root (`w-full`) lacks `min-w-0`, so its `TabsList` `overflow-x-auto` doesn't actually constrain — the parent flex column lets it grow.
- Tab content cards (`bg-card rounded-xl ... p-4`) hold Recharts `ResponsiveContainer`s. Recharts measures parent width on mount; if the parent is briefly unbounded, the SVG can render wider than the viewport and stay that way.
- `BalanceTab` radar `outerRadius="75%"` of an unconstrained box can also overshoot.

**Fix (1 file: `src/components/AnalyticsScreen.tsx`):**
1. Outer wrapper: add `overflow-x-hidden w-full max-w-full`.
2. `<Tabs>` root: add `min-w-0 max-w-full`.
3. Each `<TabsContent>`: add `min-w-0 max-w-full overflow-hidden` so chart cards can't push width.

No changes to individual tab files needed — once the parents are width-bounded, `ResponsiveContainer` measures correctly.

### Part 2 — Landscape rotation for charts

**Approach:** Allow rotation only on the Analytics screen (rest of app stays portrait-feeling). Use a CSS-only hint plus an automatic relayout — no orientation lock API (unreliable on iOS Safari).

**Fix (same file: `src/components/AnalyticsScreen.tsx`):**
1. Add a `useIsMobile()` check + a `window.matchMedia('(orientation: portrait)')` listener stored in state.
2. When **mobile + portrait**, show a small dismissible banner above the tabs:
   > 📱 Rotate your phone for a wider chart view
   With a "Got it" button that sets a `localStorage` flag (`analytics-rotate-hint-seen`) so it only appears once.
3. When **mobile + landscape**, hide the back button label area's extra padding and let charts use full width — they already use `ResponsiveContainer` so they'll automatically expand. Bump chart heights slightly (`h-48` → `h-64`) via a conditional class when landscape, so they fill the shorter landscape viewport better.

**Note:** Forced screen-orientation rotation isn't possible from a web page on iOS. The banner + responsive resize is the standard PWA pattern.

### Files touched
- `src/components/AnalyticsScreen.tsx` (only)

### What stays the same
- All tab content components, chart logic, data flow, sensor configs.

