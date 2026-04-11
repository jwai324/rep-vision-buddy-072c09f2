

## Plan: Sync Notion Exercise Database → App

### Overview
Pull all exercises from the Notion "Exercise Database" and regenerate `src/data/exercises.ts` to match. This ensures the app reflects any additions, edits, or removals made in Notion.

### Steps

**1. Query all exercises from Notion**
- Use the Notion database query tool to fetch every row from `collection://6609d987-d72a-4821-b241-fd83beff7f15`
- The database has 300+ entries; will need to paginate through search results or use the view query tool

**2. Generate updated `src/data/exercises.ts`**
- Write a script that maps each Notion row's properties to the `Exercise` interface:
  - `Exercise` (title) → `name`
  - `Primary Body Part` → `primaryBodyPart`
  - `Equipment` → `equipment`
  - `Difficulty` → `difficulty`
  - `Exercise Type` → `exerciseType`
  - `Movement Pattern` → `movementPattern`
  - `Secondary Muscles` → `secondaryMuscles`
- Auto-generate `id` from the name (lowercase, hyphenated, e.g. "Back Extension (45°)" → `back-extension-45`)
- Keep the existing `BODY_PARTS`, `EQUIPMENT_LIST`, `getBodyPartIcon` constants/helpers — update them if Notion introduces new body parts or equipment
- Preserve the Recovery/Wellness section exercises and the `Training Style` field from Notion will be ignored (not used in-app)

**3. Validate no breaking changes**
- Ensure all exercise IDs currently referenced in saved templates/sessions still exist in the new list
- If Notion removed or renamed exercises, the old IDs will be preserved or aliased

### What changes
- `src/data/exercises.ts` — regenerated `EXERCISE_DATABASE` array from Notion data; `BODY_PARTS` and `EQUIPMENT_LIST` updated if needed

### What stays the same
- Custom exercises (stored in database, unaffected)
- All other components — they reference `EXERCISE_DATABASE` which keeps the same interface

