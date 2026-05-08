
# Project Audit: Issues & Proposed Fixes

## Critical Issues

### 1. ActiveSession.tsx is 2,737 lines with 38 useState hooks
This "god component" is the single biggest risk for maintainability, migration, and debugging. Any AI agent (Claude Code or otherwise) will struggle to reason about a file this large.

**Fix:** Extract into sub-modules:
- `useSessionState` hook (timer, blocks, location, notes state)
- `useSessionPersistence` hook (localStorage caching logic)
- `SessionHeader`, `SessionExerciseList`, `SessionControls` components
- Keep `ActiveSession` as a thin orchestrator

### 2. Supabase 1,000-row default limit on workout_sessions
`useStorage.ts:178` does `select('*')` with no pagination. Users with 1,000+ sessions will silently lose older data.

**Fix:** Add `.range(0, 4999)` or implement cursor-based pagination for session history queries.

### 3. Fire-and-forget delete inside setState (line 255)
```ts
supabase.from('future_workouts').delete().eq('id', fw.id).then(() => {});
```
This runs a DB delete inside a `setFutureWorkouts` callback with no error handling. If it fails, local state diverges from DB state.

**Fix:** Move the delete calls outside the setState callback; await them and handle errors.

---

## Type Safety Issues

### 4. 22 `as any` casts in useStorage.ts
All Supabase data mapping uses `as any` instead of the generated types. This means schema drift won't produce compile errors.

**Fix:** Import types from `@/integrations/supabase/types` and use `Database['public']['Tables']['workout_sessions']['Row']` etc. for all mapping functions. The `settingsRes.data` block (lines 193-200) is especially bad — it casts the entire row to `any` 8 times.

### 5. dataPortability.ts uses `any[]` for all backup data
The entire import/export system has zero type checking. A malformed backup file could silently corrupt data.

**Fix:** Add typed interfaces for each table's row shape in the backup, validate structure before import.

---

## localStorage Concerns

### 6. Sticky notes stored only in localStorage (useStickyNotes.ts)
These are per-exercise persistent notes that will be lost on device switch or browser clear. Every other data type is in the database.

**Fix:** Create a `sticky_notes` table (or a jsonb column on `user_settings`) and sync there, with localStorage as a write-through cache.

### 7. Template/Program builder drafts in localStorage
`TemplateBuilder.tsx` and `ProgramBuilder.tsx` cache drafts to localStorage. Not a bug, but worth noting — drafts are lost cross-device. Acceptable for now.

### 8. AI chat pulse and analytics hint in localStorage
Minor UI flags (`ai-chat-pulse-seen`, analytics hint). Acceptable — no data loss risk.

---

## Data Portability Issues

### 9. Export doesn't include sticky notes
`exportUserData` exports 7 tables but sticky notes (localStorage) are excluded, so a full backup misses them.

**Fix:** After fixing issue #6, sticky notes will be in the DB and automatically included.

### 10. Import doesn't reload app state
After `importUserData` completes, the app's in-memory state (from `useStorage`) is stale. The user must refresh.

**Fix:** Have the import function trigger a full data reload (call the `load()` function from `useStorage`).

---

## Migration / Architecture Concerns

### 11. Index.tsx is 694 lines acting as router + state manager
All app routing, screen selection, and storage orchestration lives in one file. This makes it hard for any agent to modify navigation without risking regressions.

**Fix:** Extract a proper React Router setup (even hash-based) with individual route components. Move storage provider to a context.

### 12. No error boundaries around data-critical flows
`useStorage` has a single try/catch on initial load. Individual save/delete operations show a toast on error but don't prevent UI from assuming success (optimistic updates without rollback).

**Fix:** Add rollback logic to `saveSession`, `saveTemplate`, etc. — on error, revert the local state update.

---

## Summary Table

| # | Severity | Issue | Effort |
|---|----------|-------|--------|
| 1 | High | ActiveSession 2700+ lines | Large |
| 2 | High | 1000-row query limit | Small |
| 3 | Medium | Fire-and-forget delete | Small |
| 4 | Medium | 22 `as any` casts | Medium |
| 5 | Low | Untyped backup format | Medium |
| 6 | Medium | Sticky notes localStorage-only | Medium |
| 7 | Low | Draft caching localStorage | N/A |
| 8 | Low | UI flags localStorage | N/A |
| 9 | Medium | Export misses sticky notes | Small |
| 10 | Low | Import doesn't reload state | Small |
| 11 | Medium | Index.tsx god-page | Large |
| 12 | Medium | No optimistic update rollback | Medium |

**Recommended priority for Claude Code migration readiness:** #2, #3, #4 first (small/medium effort, high impact on correctness), then #1 and #11 (large refactors that unlock maintainability).

Let me know which issues you'd like me to fix, or if you want me to tackle them in priority order.
