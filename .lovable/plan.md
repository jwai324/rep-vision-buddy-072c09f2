## Persist Locations to Database

### Database Migration

Add two columns:
```sql
ALTER TABLE public.workout_sessions ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS custom_locations jsonb NOT NULL DEFAULT '["Home Gym"]'::jsonb;
```

### Code Changes

**`src/types/workout.ts`** — Add `location?: string` to `WorkoutSession` interface (after `note`).

**`src/hooks/useStorage.ts`** — 4 changes:
1. `UserPreferences` interface: add `customLocations: string[]`
2. `DEFAULT_PREFERENCES`: add `customLocations: ['Home Gym']`
3. `mapSession`: add `location: row.location ?? undefined`
4. `saveSession`: add `location: session.location ?? null` to the upsert
5. Load settings: add `customLocations: (settingsRes.data as any).custom_locations ?? ['Home Gym']`
6. `updatePreferences`: add `custom_locations: updated.customLocations` to the upsert
7. Export `customLocations` and add `saveCustomLocations` callback or rely on `updatePreferences`

**`src/components/ActiveSession.tsx`** — 3 changes:
1. Accept `customLocations` and `onUpdateCustomLocations` props (or read from preferences)
2. Replace `getSavedLocations()` / `saveLocations()` localStorage functions with the DB-backed list from props
3. In the `finalSession` object (~line 1428): add `location` field from the current `location` state
4. Remove `LOCATIONS_KEY`, `getSavedLocations`, `saveLocations` localStorage functions (lines 55-70)

**`src/components/ActiveSession.tsx` props** — The parent component that renders `ActiveSession` needs to pass `customLocations` from `preferences.customLocations` and a callback to update them via `updatePreferences({ customLocations: [...] })`.

**No changes needed to `src/utils/dataPortability.ts`** — It already exports full rows via `select('*')`, so the new `location` column on sessions and `custom_locations` on settings will be included automatically in export and restored on import.
