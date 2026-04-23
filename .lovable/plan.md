

## Reduce swipe-to-delete sensitivity

### Problem
The swipe-to-delete gesture on sets triggers too easily — the 80px threshold is low for touch interactions, causing accidental deletions.

### Fix

**`src/components/SwipeToDelete.tsx`**:
1. Increase `THRESHOLD` from `80` to `120`.
2. Increase the max drag cap from `120` to `160`.
3. Increase the icon-show threshold from `40` to `60`.

This requires a more deliberate swipe before the delete action fires.

### Files
- Modify: `src/components/SwipeToDelete.tsx`

