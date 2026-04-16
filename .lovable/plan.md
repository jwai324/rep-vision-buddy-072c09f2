

## Fix: Existing Weight Data Stored as Raw LBS, Now Double-Converted

### Root cause
Before the weight conversion system was added, all weights were entered and stored as raw lbs values. The new system assumes stored values are in kg and applies `fromKg()` (×2.2) when displaying in lbs — inflating all historical data by ~2.2×.

The `toKg()` conversion on save (in `ActiveSession.tsx`) only applies to **new** sessions. All existing data in the database is still in lbs.

### Fix approach
Run a one-time database migration to convert all existing weight data from lbs to kg. This affects two things in `workout_sessions`:

1. **`exercises` JSONB column** — each set's `weight` field needs dividing by 2.20462
2. **`total_volume` column** — needs dividing by 2.20462

The migration will update all rows where the user's `weight_unit` setting is `'lbs'` (or where no setting exists, since the default is lbs). Users who already had kg set would have correct data.

### Changes

**1. Database migration (SQL)**
- For each user whose `weight_unit` is `'lbs'` (or has no `user_settings` row — defaulting to lbs):
  - Update `workout_sessions.total_volume` by dividing by 2.20462
  - Update each weight value inside the `exercises` JSONB array using a PL/pgSQL function that walks the nested structure (`exercises[].sets[].weight`)
- This is idempotent-safe by checking a flag or only running once

**2. No code changes needed**
- The conversion system (`toKg`/`fromKg`) is already correct for new data
- Default unit is already `'lbs'`
- Display logic is already correct assuming stored data is in kg

### Migration SQL outline
```sql
-- Update total_volume for lbs users
UPDATE workout_sessions ws
SET total_volume = total_volume / 2.20462
WHERE EXISTS (
  SELECT 1 FROM user_settings us 
  WHERE us.user_id = ws.user_id AND us.weight_unit = 'lbs'
) OR NOT EXISTS (
  SELECT 1 FROM user_settings us WHERE us.user_id = ws.user_id
);

-- Update weight values inside exercises JSONB
-- PL/pgSQL function to walk exercises[].sets[].weight
-- and divide each non-null weight by 2.20462
```

### Risk mitigation
- The migration only affects existing rows, not future inserts
- New sessions saved via `ActiveSession.tsx` already call `toKg()` correctly
- If a user was using kg, their `weight_unit` would be `'kg'` and they'd be excluded

