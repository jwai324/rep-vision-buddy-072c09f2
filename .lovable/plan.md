

## Fix: Previous set data misaligned when warmup sets are added

### Problem
The "Previous" column in the active session uses `previousSets[setIdx]` — a direct array index. When warmup sets are added, they shift the index so that set 1's previous data appears next to set 2, set 2's next to set 3, etc. Previous sessions typically don't include warmup sets, causing the mismatch.

### Fix

**`src/components/ActiveSession.tsx`** — in the `ExerciseTable` component (around line 2362):

Instead of `previousSets[setIdx]`, compute a working-set index that skips warmup rows:

```tsx
// Count how many non-warmup sets appear before this setIdx
const workingSetIndex = block.sets.slice(0, setIdx).filter(s => s.type !== 'warmup').length;
const prevSet = set.type !== 'warmup' ? previousSets[workingSetIndex] : undefined;
```

Then use `prevSet` instead of `previousSets[setIdx]` for both the display and the copy-on-tap handler. Warmup sets will show "—" for previous (since there's no historical warmup data to match).

Apply the same logic in both places where `previousSets[setIdx]` is referenced (the display button and the onClick handler).

### Files
- Modify: `src/components/ActiveSession.tsx`

