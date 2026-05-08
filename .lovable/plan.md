## Future Workout Cards — Improved Layout

**`src/components/StartWorkoutScreen.tsx`** — Update the future workout card (lines 100–106):

- **Line 1**: Program label (`fw.label`) — already present, keep as-is.
- **Line 2**: Template name (`template.name`) shown as a secondary muted line, only when a template is found.
- **Line 3**: Date on its own line, slightly larger (`text-sm font-medium`) so it stands out. Remove the inline `·` concatenation with exercise names.

Result: each future workout card shows the program day name, the template name underneath, and the date prominently on its own line.
