
## Change cardio "Time" header to "Minutes"

The cardio table header column currently labeled `Time` should read `Minutes` to make the unit explicit at the top of the column.

### Change
- `src/components/ActiveSession.tsx` line 2209: `<span className="text-center">Time</span>` → `<span className="text-center">Minutes</span>`

That's the only edit. The input still accepts `m:ss` format via `parseMmSs`; only the header label changes.

### Validation
- Open a cardio exercise in an active session → top column header reads "Minutes" instead of "Time".
- Weighted/band tables unchanged.
