## Data Export & Import Feature

Add export/download and import/upload buttons to the Settings screen so users can back up all their data as a JSON file and restore it on any instance of the app.

### What gets exported

A single `.json` file containing all user data:
- **workout_sessions** — all completed workouts
- **workout_templates** — saved templates
- **workout_programs** — programs and schedules
- **future_workouts** — upcoming scheduled workouts
- **custom_exercises** — user-created exercises
- **user_settings** — preferences (units, rest timer, streak settings, etc.)
- **profile** — display name

The file is timestamped (e.g. `repvision-backup-2026-05-08.json`) and includes a version field for future compatibility.

### What gets imported

The same JSON file. On import:
- Each table's data is upserted (matching on `id`), so duplicates are safely handled.
- The user is shown a confirmation dialog before import proceeds, listing counts (e.g. "42 sessions, 5 templates, 2 programs").
- `user_id` fields are replaced with the current authenticated user's ID, so the data works on any account/instance.

### UI Changes

**`src/components/SettingsScreen.tsx`**
- Add a "Data Management" section near the bottom (above Sign Out) with two buttons:
  - **Export Data** — downloads the JSON backup file
  - **Import Data** — opens a hidden file input, parses the JSON, shows confirmation, then upserts

### New file

**`src/utils/dataPortability.ts`**
- `exportUserData(supabase, userId)` — queries all 6 tables, bundles into a typed JSON object, triggers browser download
- `importUserData(supabase, userId, data)` — validates the JSON shape, replaces user_id fields, upserts each table in order (settings first, then templates, programs, sessions, future workouts, custom exercises)
- Includes a version constant and basic schema validation

### Technical details
- No database or migration changes needed — uses existing tables and upsert operations
- Works with the existing RLS policies since all operations use the authenticated user's ID
- File size is typically small (a few hundred KB for most users)
