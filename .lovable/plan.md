

## Persist "Hide Timers" toggle with bidirectional sync

### Summary

Add a persistent `hideTimers` preference stored in the database. The setting is accessible from both the Settings page and the active workout three-dot menu. Changing it in either place updates the same underlying preference, so they stay in sync.

### Database migration

Add a `hide_timers` column to `user_settings`:

```sql
ALTER TABLE public.user_settings
  ADD COLUMN hide_timers boolean NOT NULL DEFAULT false;
```

### Implementation

**`src/hooks/useStorage.ts`**:
1. Add `hideTimers: boolean` to `UserPreferences` interface.
2. Add `hideTimers: false` to `DEFAULT_PREFERENCES`.
3. Map `hide_timers` from DB to `hideTimers` in the fetch logic.
4. Include `hide_timers: updated.hideTimers` in the `updatePreferences` upsert payload.

**`src/pages/Index.tsx`**:
1. Pass `hideTimers={storage.preferences.hideTimers}` and `onUpdateHideTimers={(val) => storage.updatePreferences({ hideTimers: val })}` as new props to `ActiveSession`.

**`src/components/ActiveSession.tsx`**:
1. Add `hideTimers` and `onUpdateHideTimers` props to `ActiveSessionProps`.
2. Replace the local `useState(false)` with `useState(hideTimers)` (initialized from the prop).
3. Update the three-dot menu toggle to also call `onUpdateHideTimers` when toggled, so the change persists to the database and syncs with Settings.

**`src/components/SettingsScreen.tsx`**:
1. Add a "Hide Timers" toggle card with a `Switch`, similar to the existing "Drop Sets" toggle:
   - Icon: `Timer`
   - Title: "Hide Timers"
   - Description: "Hide rest timers between sets and exercises by default"
   - Wired to `preferences.hideTimers` / `onUpdatePreferences({ hideTimers: checked })`

### Files
- Migration: add `hide_timers` column to `user_settings`
- Modify: `src/hooks/useStorage.ts`
- Modify: `src/pages/Index.tsx`
- Modify: `src/components/ActiveSession.tsx`
- Modify: `src/components/SettingsScreen.tsx`

