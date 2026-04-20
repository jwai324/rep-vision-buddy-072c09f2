

Let me explore the codebase to understand the dashboard, session flow, and settings before planning.
<lov-tool-use id="toolu_vrtx_0122ErR2ihLDivjbQWzj8FqA" name="code--view" integration-id="code" data="{\"file_path\": \"src/pages/Index.tsx\", \"lines\": \"1-80\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01QXKpeUhUpru9jkNCPk59c4" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/Dashboard.tsx\", \"lines\": \"1-60\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01896NYwU15SiMQweti5tKFE" name="code--view" integration-id="code" data="{\"file_path\": \"src/pages/Index.tsx\", \"lines\": \"1-100\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01FHpAsMLDChkNC242vzyY4H" name="code--view" integration-id="code" data="{\"file_path\": \"src/components/Dashboard.tsx\", \"lines\": \"1-80\"}">
</lov-tool-use>
I have enough context to draft a plan.

<lov-plan>

## Onboarding Tutorial Overlay

Add a guided overlay tour covering the Dashboard and a New Workout Session. Auto-launches on first login; replayable from Settings.

### Approach
Use a lightweight custom overlay (no extra deps) — a fixed dark backdrop with a "spotlight" cutout via `box-shadow` over the targeted element, plus a tooltip card with step text, progress dots, and Back/Next/Skip controls.

### Components

**`src/components/TutorialOverlay.tsx`** (new)
- Props: `steps: TutorialStep[]`, `onClose: () => void`.
- Each `TutorialStep`: `{ targetId: string; title: string; body: string; placement?: 'top'|'bottom'|'auto' }`.
- Reads target via `document.getElementById(targetId).getBoundingClientRect()`, recalculates on resize/scroll.
- Renders: full-screen `fixed inset-0 z-[100]` backdrop, a transparent rectangle with `box-shadow: 0 0 0 9999px rgba(0,0,0,0.75)` for the spotlight, and a tooltip card positioned beside the target.
- If target missing, falls back to centered modal step.

**`src/contexts/TutorialContext.tsx`** (new)
- Exposes `startTutorial(flow: 'main')`, `tutorialActive`, `currentFlow`.
- Defines two flows in one main flow (chained):
  1. **Dashboard steps** — target Dashboard elements (welcome, streak, weekly sets, calendar, Start Workout button, sidebar/nav).
  2. **New Session steps** — once user reaches `activeSession`, overlay continues automatically: exercise add, weight/reps inputs, RPE, complete set ✓, rest timer, finish button.
- Listens to route/screen changes; advances when the user lands on `activeSession` for the steps that require it.

### Trigger logic

**`src/hooks/useStorage.ts`** — extend `UserPreferences` with `tutorialCompleted: boolean` (default `false`). Persisted via existing prefs flow (Supabase `user_preferences`).

**`src/pages/Index.tsx`**
- After `storage.loading` resolves, if `!preferences.tutorialCompleted`, call `startTutorial('main')` once.
- On tutorial completion/skip → `onUpdatePreferences({ tutorialCompleted: true })`.

**`src/components/SettingsScreen.tsx`** — add a new row "Replay Tutorial" (icon: `GraduationCap` from lucide). Tap → calls `startTutorial('main')`.

### Element targeting
Add `id="tutorial-*"` attributes to existing elements (no visual change):
- Dashboard: `tutorial-streak`, `tutorial-weekly-sets`, `tutorial-calendar`, `tutorial-start-btn`
- ActiveSession: `tutorial-add-exercise`, `tutorial-weight-input` (first set), `tutorial-complete-set`, `tutorial-finish-btn`

### DB migration
```sql
ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS tutorial_completed boolean NOT NULL DEFAULT false;
```
Update preferences load/save in `useStorage.ts` to include the new field.

### Files
- New: `src/components/TutorialOverlay.tsx`, `src/contexts/TutorialContext.tsx`
- Modify: `src/pages/Index.tsx`, `src/hooks/useStorage.ts`, `src/components/SettingsScreen.tsx`, `src/components/Dashboard.tsx`, `src/components/ActiveSession.tsx`
- Migration: add `tutorial_completed` column

### UX details
- Backdrop click does nothing (prevents accidental dismiss); explicit Skip/Close button in tooltip.
- Mobile-friendly: tooltip auto-flips above/below target, max-width clamped to viewport.
- Smooth fade-in via existing `animate-fade-in` utility.
- ESC key skips tutorial.

### Validation
- Fresh login → overlay auto-starts on Dashboard, walks through steps, transitions into a new session walkthrough, then marks completed.
- Reload → does not re-trigger.
- Settings → "Replay Tutorial" → restarts the full flow.
- Resize/scroll → spotlight tracks target correctly.

