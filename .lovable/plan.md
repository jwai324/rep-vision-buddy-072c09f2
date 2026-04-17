

## Fix horizontal scroll on New Program page

### Cause
`src/components/ProgramBuilder.tsx` outer wrapper (`p-4 flex flex-col gap-4 pb-24`) has no horizontal overflow guard. Inside, several children can push width on a 390px viewport:
- Day cards (no `min-w-0`) — long template names in `<select>` options and the `<input>` label can force width.
- Weekday button row (`flex flex-wrap gap-1.5`) — already wraps, fine.
- Calendar preview (`numberOfMonths={1}` with `w-full`) — generally fine but its parent card has `p-3` and inner Calendar adds its own `p-3`, occasionally overflowing on narrow screens.
- The `<select>` elements have no `max-w-full` / `w-full`, so very long option labels (e.g. past workout entries listing every exercise name) can stretch them.

### Fix (single file: `src/components/ProgramBuilder.tsx`)
1. Outer wrapper: add `overflow-x-hidden min-w-0 max-w-full`.
2. Each day card (`bg-card rounded-xl p-4 ...`): add `min-w-0`.
3. All `<select>` and `<input>` inside day cards and the duration row: add `w-full min-w-0` so they shrink to container width instead of growing.
4. Calendar preview card: add `min-w-0 overflow-hidden`; on the inner `<Calendar>` keep `w-full` but drop the redundant outer `p-3` (Calendar already has its own padding) to avoid horizontal pressure.
5. Header row (title + Cancel): add `min-w-0` and `truncate` on the title so a long edit-title can't push width.

No logic changes, no API changes, no other files touched.

