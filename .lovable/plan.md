

## Make the fire streak configurable

### Current behavior
`getStreak` in `Dashboard.tsx` only counts consecutive days that contain ANY session (workouts or rest days mixed). There's no setting — rest days currently extend the streak even if the user only cares about training.

### Proposed two streak modes (user setting)

**Mode A — "Daily" (workouts + rest days count)**
Same as today: every consecutive day with either a logged workout OR a rest day counts. Today is skipped if empty.

**Mode B — "Weekly target" (workouts per week)**
User picks a target like "3 workouts/week". Streak = number of consecutive completed weeks (Mon–Sun) in which the workout count met the target. The current week counts toward the streak only if already met (otherwise it doesn't break the streak — it just hasn't extended yet).

Rest days are ignored in this mode (they're not "workouts").

### Plan

**1. Schema — add 2 columns to `user_settings`** (migration)
- `streak_mode text not null default 'daily'` — `'daily' | 'weekly'`
- `streak_weekly_target int not null default 3` — only used when mode = `'weekly'`

**2. `useStorage.ts`**
- Extend `UserPreferences` with `streakMode: 'daily' | 'weekly'` and `streakWeeklyTarget: number`.
- Read/write the two new columns in load + `updatePreferences` upsert.

**3. `SettingsScreen.tsx`** — new "Streak" card
- Segmented toggle: **Daily** vs **Weekly target**.
- When Weekly is selected, show a row of buttons: 1 / 2 / 3 / 4 / 5 / 6 / 7 workouts per week.
- Brief helper text under each mode explaining what counts.

**4. `Dashboard.tsx`** — replace `getStreak`
- Accept `preferences` and compute:
  - **daily**: existing logic (consecutive days with any session, skipping empty today).
  - **weekly**: walk back week-by-week (Mon–Sun via `startOfWeek({ weekStartsOn: 1 })`); count workouts (sessions where `!isRestDay`) per week. For each previous completed week with `count >= target`, streak++. If a previous week falls short, stop. Current week: if met, +1; if not met, don't increment but don't break.
- Tooltip/subtext under the 🔥 number adjusts: "day streak" vs "week streak (3/wk)".

**5. `ConsistencyTab.tsx`** (Analytics → Streaks)
- Receive `preferences` from `AnalyticsScreen` and apply the same mode for "Current Streak" and "Longest Streak" so all surfaces stay consistent.
- Longest streak in weekly mode = longest run of consecutive weeks meeting the target.

### Files
- New migration: add `streak_mode`, `streak_weekly_target` columns to `user_settings`
- Modify: `src/hooks/useStorage.ts`, `src/components/SettingsScreen.tsx`, `src/components/Dashboard.tsx`, `src/components/AnalyticsScreen.tsx`, `src/components/analytics/ConsistencyTab.tsx`

### Unchanged
- RLS, sessions/futureWorkouts tables, all other screens.

### Validation
- Settings → switch to Weekly, target 3/wk → 🔥 reflects completed weeks.
- Switch back to Daily → 🔥 matches old behavior.
- Analytics → Streaks tab shows the same values as the dashboard 🔥 in both modes.

