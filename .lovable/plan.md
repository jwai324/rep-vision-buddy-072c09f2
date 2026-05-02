
## Fix superset group labeling in Focus Mode

The current code labels the exercise's **position within** a superset group (A = 1st exercise, B = 2nd exercise). The user wants the superset **group itself** labeled: Superset A for the first pair, Superset B for the second pair, etc.

### Change

**`src/components/FocusMode.tsx`** — Update the `supersetLabel` useMemo (lines 216-223):

- Collect all unique `supersetGroup` IDs from the blocks, sorted.
- Use the ordinal of the current block's group for the letter (A, B, C...).
- Show the position within the group as "X of Y".
- New format: `Superset A · 1 of 2` (group letter + position within group).
