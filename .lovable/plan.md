
## RPE input → tap-to-open scroll wheel picker (1–10, 0.5 increments)

### What changes
Replace the three RPE `<input type="number">` fields in `ActiveSession.tsx` (cardio row, weighted row, and dropset row) with a tappable button that opens a Popover containing a vertical scroll-wheel picker of values: `1, 1.5, 2, 2.5, … 9.5, 10` (19 options).

### New component: `src/components/RpeWheelPicker.tsx`
A self-contained wheel picker:
- Vertical scroll list of 19 RPE values, snap-to-center (`scroll-snap-y mandatory`, each row `scroll-snap-align: center`).
- Fixed height (~180px) with center highlight band (selected value gets `bg-primary text-primary-foreground` + larger font); off-center values fade and shrink for that "iOS picker" feel.
- On scroll end (debounced) or on tap of a row → call `onChange(value)` and close the popover.
- On open, auto-scrolls to the current value (or 7 as a sensible default if empty).
- Includes a small "Clear" button to wipe RPE.

Props:
```ts
{ value: string; onChange: (v: string) => void; onClose?: () => void }
```

### Integration in `ActiveSession.tsx`
Replace each of the 3 RPE `<input>` blocks (lines ~1834, ~1920, ~1990) with:
```tsx
<Popover>
  <PopoverTrigger asChild>
    <button id={buildInputId(...)} className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 ...">
      {set.rpe || '—'}
    </button>
  </PopoverTrigger>
  <PopoverContent className="w-32 p-0" side="top" align="center">
    <RpeWheelPicker value={set.rpe} onChange={v => onUpdateSet(blockIdx, setIdx, 'rpe', v)} />
  </PopoverContent>
</Popover>
```
Same pattern for cardio and dropset variants (using `onUpdateDrop` for drops). Keep the `buildInputId` so focus navigation still works.

### Validation
`validateRpe` in `src/utils/setValidation.ts` already accepts 1–10 in 0.5 increments — no change needed. Picker only emits valid values, so manual validation errors disappear.

### Files touched
- `src/components/RpeWheelPicker.tsx` (new)
- `src/components/ActiveSession.tsx` (replace 3 RPE input blocks)

### What stays the same
- RPE storage format (string of a number), analytics, average RPE calc, focus navigation IDs, all other inputs.
