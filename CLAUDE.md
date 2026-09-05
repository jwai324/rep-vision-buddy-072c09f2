# CLAUDE.md

Project guide for Claude Code working in this repo.

## What this app is

RepVision is a workout tracking PWA. The user plans workouts (templates → programs), runs live sessions, and can talk to an AI coach that edits their templates/programs/active session through tool calls.

## Stack

- **Frontend**: Vite + React 18 + TypeScript, Tailwind + shadcn/ui, React Router (`BrowserRouter`, real paths — `vercel.json` rewrites everything to `/`), TanStack Query
- **Backend**: Supabase (Postgres + Auth + Edge Functions running on Deno)
- **AI**: Anthropic Claude API (`claude-opus-4-7`) via the official SDK, invoked from two edge functions

## Repo layout

```
src/
  pages/              Top-level routes (Auth, etc.)
  components/         Feature components (AIProgramBuilder, ActiveSession, ...)
  contexts/           App-wide React contexts (notably ChatContext.tsx — 680 lines, holds the AI chat loop)
  hooks/              Custom hooks (useStorage is the data layer)
  integrations/
    supabase/         Generated types + client (do not edit by hand; regenerate via Supabase CLI)
  data/               Static reference data (exercise library, etc.)
  utils/              Pure helpers
  types/              Shared types
supabase/
  config.toml         Supabase project config
  migrations/         SQL migrations
  functions/
    ai-coach/         Streaming chat endpoint with tool use
    generate-program/ One-shot program builder, returns JSON
```

## Applying schema changes

New files under `supabase/migrations/` do NOT deploy on their own. After adding a migration you must either run `supabase db push` locally or apply it via the Supabase MCP server (`mcp__Supabase__apply_migration`), then regenerate the TypeScript types (`supabase gen types typescript --linked > src/integrations/supabase/types.ts`) so `Database` reflects the new schema. Shipping migration SQL without applying it produces silent client-side upsert failures against the missing columns.

## Deploying edge functions

Like migrations, edits under `supabase/functions/` do NOT ship on their own — the frontend auto-deploys, the functions do not. After changing either function run `supabase functions deploy <name>` (or deploy via the Supabase MCP server) and check the deployed version, because a client/server skew here fails *quietly*: the client keeps parsing a stream the old server no longer produces the same way. The 2026-05-18 → 2026-08 skew, for example, left `max_tokens` at 1024 and the `max_tokens` → `finish_reason: "length"` mapping unshipped, so every large template edit came back as "The proposal came back incomplete" instead of the real "too big, ask in smaller pieces".

## AI integration

Both edge functions talk to Anthropic directly via `npm:@anthropic-ai/sdk`. The API key lives in `ANTHROPIC_API_KEY` (set as a Supabase function secret).

Note that `SYSTEM_PROMPT` and the other prompt blocks are template literals: a stray backtick in prompt prose ends the string and the file stops compiling, which surfaces only at deploy time.

### `ai-coach`

Streams a response that the client (`src/contexts/ChatContext.tsx`) parses as an OpenAI-style SSE stream. To avoid rewriting the 680-line ChatContext, the edge function **translates Anthropic stream events into OpenAI-shaped SSE chunks** (see `translateStream` in `supabase/functions/ai-coach/index.ts`). When making changes to either side:

- Client expects `data: {"choices":[{"delta":{...},"finish_reason":null}]}` lines, terminated by `data: [DONE]`.
- Anthropic emits `content_block_start`, `content_block_delta` (with `text_delta` or `input_json_delta`), and `message_delta`. The translator maps those to the OpenAI shape.
- The client also sends tool results back in OpenAI shape (`role: 'tool'` messages with `tool_call_id`). `toAnthropicMessages` converts those to Anthropic's `tool_result` content blocks before sending.
- A `stop_reason` of `max_tokens` is translated to `finish_reason: "length"`. That matters because a tool call cut off mid-`input_json_delta` reaches the client as unparseable JSON; `parseAccumulatedToolCalls` in ChatContext flags those instead of letting them fall through validation as empty arguments. Tool JSON for a full-workout template runs to a few thousand tokens, so keep `MAX_TOKENS` well above that.

Template mutations come in two flavours, and the split exists for output-budget reasons: `edit_template` replaces the whole exercise list (so the model must re-send everything that should survive), while `add_exercises_to_template` appends only the new ones. Additions must use the append tool — a full re-send of a long template is thousands of tokens of tool JSON and is what pushes a reply into truncation. The client dedupes on `exerciseId` (`appendableTemplateExercises`) so a model that re-sends the list anyway can't duplicate rows.

A stream that dies after it has started (upstream billing, rate limit, dropped connection) is reported as a bare `data: {"error": "<plain sentence>"}` chunk with no `choices`. The client surfaces that sentence as the coach's reply — before this it skipped the payload and rendered an empty bubble, so an out-of-credits API key looked like the app silently doing nothing.

**Prompt caching** is enabled on the system prompt and on the last tool definition (Anthropic caches everything up through the last `cache_control` marker). Both are stable across a session, so most turns should hit the cache.

### `generate-program`

One-shot, non-streaming. Returns JSON. The system prompt has `cache_control: { type: "ephemeral" }` so consecutive program generations from the same user reuse the cache.

### Model

Default model is `claude-opus-4-7` (the most capable model in the Claude 4.x family). If responses are too expensive, swap to `claude-sonnet-4-6` — both edge functions have a `MODEL` constant at the top.

## Voice input (AI coach chat)

`src/utils/speechToText.ts` drives the mic button in `AIChatBubble`, via
`useSpeechToText`. It was rebuilt from scratch after two designs built on
continuous-mode sessions kept duplicating words ("add three sets three sets of
squats"). Three rules hold it together:

- **One utterance per browser session.** The recognizer runs with
  `continuous` off, the mode every browser implements the same way: hear one
  utterance, finalize it, end. Continuous mode is where phone browsers go
  wrong — Chrome for Android segments a long session internally and its own
  result list can carry the same audio twice at different indices, which no
  bookkeeping on our side can tell from a real repetition. Keep `continuous`
  off; turning it back on is how the duplicates come back.
- **A session's text is a pure function of its latest result list.** Nothing
  is appended per event: each `onresult` carries the browser's whole list for
  the session, so `transcriptOf` recomputes the session's text from it. Two
  structural rules cover the ways browsers list one phrase twice — an entry
  identical to the one before it is dropped, and an entry that begins with the
  whole of the one before it replaces it. There is deliberately no word-level
  overlap guessing; an earlier version had it and it cut real words out.
- **Sessions are chained by the app and never overlap; words are handed over
  once.** When the browser ends a session that heard speech, the next one
  opens so the user can keep talking; a session that heard nothing ends the
  run (that is how silence releases the mic), as does 10 s without a result.
  Handlers are bound to their own session object and ignored once it is no
  longer current. Each ended session's text is banked once, in order, and the
  run's words reach the caller exactly once, through `onEnd`, when the run
  finishes — never through an effect that could re-run.

The mic button ending a run calls `stop()`, which gives the browser a second to
finalize the phrase in flight before its interim text is taken as it stands.
The chat composes `input + transcript` at render time while a run is on and
folds the words in through `onEnd`. Sending or typing calls `cancel()`: the
words are already in the message or the box, so the run is dropped rather than
handed over on top of them. Closing the panel calls `stop()`, so the words land
in the persisted draft.

Trade-offs to know: there is a short gap between chained sessions, so words
spoken in the instant after a pause can be missed (pause, then continue), and
Android plays its start sound at the top of every session. Both are the price
of a mode that cannot double a word.

Tests: `src/test/speechToText.test.ts` (engine, including seeded browser
"personalities" that replay, duplicate and cumulate) and
`src/test/aiChatSpeech.test.tsx` (panel integration, including StrictMode).
`src/test/helpers/fakeSpeechRecognition.ts` is the shared fake.

## OAuth

Native Supabase OAuth (`supabase.auth.signInWithOAuth`) — see `src/pages/Auth.tsx`. To enable Google sign-in, configure the Google provider in the Supabase dashboard (Authentication → Providers) with your OAuth client ID and redirect URI.

## Supabase project setup runbook

If you need to provision a fresh Supabase project (e.g., moving off the old `wekcpvqydhaaupjfkkno` instance):

1. Create the project at https://supabase.com/dashboard. Pick a region close to your users.
2. Install the Supabase CLI: `npm install -g supabase`. Log in: `supabase login`.
3. Link locally: `supabase link --project-ref <new-project-ref>`.
4. Push the schema: `supabase db push` (applies everything under `supabase/migrations/`).
5. Set the Anthropic API key as a function secret:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```
6. Deploy both edge functions:
   ```bash
   supabase functions deploy ai-coach
   supabase functions deploy generate-program
   ```
7. Configure Google OAuth in the dashboard (Auth → Providers → Google) and add `http://localhost:8080` plus your production URL to the allowed redirect list.
8. Update `.env` with the new project URL and anon key (copy them from Settings → API in the dashboard).
9. Regenerate types: `supabase gen types typescript --linked > src/integrations/supabase/types.ts`.

## Environment variables

`.env` (gitignored — see `.env.example` for the template):

| Variable                       | Used by | Purpose                                  |
| ------------------------------ | ------- | ---------------------------------------- |
| `VITE_SUPABASE_URL`            | Client  | Supabase project URL                     |
| `VITE_SUPABASE_PUBLISHABLE_KEY`| Client  | Supabase anon key (public, safe in JS)   |
| `VITE_SUPABASE_PROJECT_ID`     | Client  | Used for some legacy references          |

Server-side secrets (set via `supabase secrets set`, never in `.env`):

| Secret                       | Used by             |
| ---------------------------- | ------------------- |
| `ANTHROPIC_API_KEY`          | Both edge functions |
| `SUPABASE_URL`               | Auto-set            |
| `SUPABASE_SERVICE_ROLE_KEY`  | Auto-set            |

## Capacitor (when you're ready for mobile)

The app isn't wrapped for native yet. When you're ready:

1. `npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android @capacitor/browser`
2. `npx cap init RepVision com.yourcompany.repvision`
3. Add platforms: `npx cap add ios && npx cap add android`
4. For OAuth on native: swap the Google sign-in handler in `Auth.tsx` to open the OAuth URL with `@capacitor/browser` rather than `signInWithOAuth` (which uses `window.location`), and register a custom URL scheme (e.g. `com.yourcompany.repvision://callback`) as a deep link so Supabase can return the session.
5. After every web build: `npm run build && npx cap sync`.

## Data loading and the local snapshot

`useStorage` is the only place the app's data is fetched. Two things about it
are easy to break by accident:

- **Effects are keyed on `user?.id`, never the `user` object.** Supabase hands
  back a freshly deserialized user on every auth event, including the token
  refreshes that fire when the tab regains focus. `AuthContext` holds the
  previous object when the id and `updated_at` both match, so a refresh is a
  no-op; keying anything on `user` identity reintroduces a full reload of the
  app on every refocus.
- **Loaded data is mirrored to localStorage** (`src/utils/storageCache.ts`)
  and read back on mount, so a returning app paints real content instead of
  the spinner while it revalidates. `loading` means "nothing to show yet";
  `refreshing` means "data on screen, network in flight" — gate full-screen
  spinners on `loading` only.

If you add a field to `useStorage`'s state, add it to `CachedStorage` too, or
it will be blank on a hydrated open until revalidation lands. Changing the
shape of anything cached means bumping `CACHE_VERSION`.

`saveTemplate` is the one write that survives a failure. It resolves
`false` rather than throwing, applies the edit locally anyway, and parks the
template in `src/utils/pendingTemplateWrites.ts`; the next successful load
lays those entries over the loaded rows and replays them. The update-template
prompt at the end of a workout is why: it fires once, on a gym phone that may
have no signal, and its screen unmounts moments later, so a dropped upsert
had nothing to retry from and the change was gone — while the session itself
still saved, because the user was sitting on the summary screen and could
press Save again. Anything that resolves a template's fate (a later
successful save, a delete) must clear its queued entry, or the replay
resurrects it.

## Exercise names are resolved, never trusted

`ExerciseBlock` and `ExerciseLog` carry an `exerciseName` next to the
`exerciseId`, but it is only ever a snapshot of what the library said when the
row was created. Built-in exercises ship with the bundle; custom ones load from
Supabase after mount (`useCustomExercises` has no localStorage cache), so a row
created in that window falls back to the raw `custom-<uuid>` id — and that
string then persists into the session cache, the saved log, and every screen
that reads the log back.

The id is the source of truth. Resolve names at read time
(`useExerciseLookup()`, or `buildExerciseLookup` in the share snapshot builders)
and keep the stored name only as the fallback for an id the library no longer
knows, e.g. a deleted custom exercise. `src/utils/exerciseNames.ts` holds the
two helpers; `ActiveSession` re-resolves its blocks whenever the lookup changes,
which is what heals a session that started before the custom library landed.
Anything the AI coach renders is subject to the same rule — the proposal diff
card resolves through the merged lookup, not `EXERCISE_DATABASE`.

## Exercise input modes

`getExerciseInputMode` turns an exercise's `measurementType` into one of the
`ExerciseInputMode` values, and every logging surface (the live set table, the
template builder, the session summary, validation, the finish path) branches on
that mode rather than on the measurement type directly.

The mode says which fields *lead*, not which are *allowed*. Weight is offered
on every rep- or time-based mode — a calf raise iso done with a kettlebell, a
weighted pull-up — and is optional there: `canCompleteSet` gates on reps or
duration alone, and an unloaded set renders exactly as it did before the field
existed (`12 reps`, `0:45`). `usesWeight` is the single gate; distance-only
work is the one thing it excludes, because that numeric field is kilometres.
Band levels are picked from a list rather than typed, so they never surface a
weight *error* even though `usesWeight('band')` is true.

Practical consequence: `'time'` renders like `'weight-time'` and `'reps'` like
`'reps-weight'`, so those switch cases are deliberately merged. Keep them
merged — splitting them back out is how the weight field goes missing again.

## Volume exclusions

A custom exercise can carry `exclude_from_volume` (see `CustomExercise` in
`src/hooks/useCustomExercises.ts`), which keeps rehab/mobility/isometric work
out of volume and set aggregates without hiding it from the log.

- **The flag is applied at read time, never baked into stored totals.**
  `workout_sessions.total_volume` / `total_sets` / `total_reps` stay exactly as
  the session was saved, and `src/utils/volumeExclusions.ts` nets the excluded
  exercises back out wherever those totals are aggregated. Flipping the switch
  therefore re-scores existing history in both directions.
- Because the stored totals count every set including warmups,
  `excludedSessionTotals` counts them the same way. Subtracting a differently
  scoped number would make corrected totals drift from raw ones.
- Applied to: weekly sets by body part (`Dashboard`), both charts in
  `analytics/VolumeTab`, movement-pattern sets in `analytics/BalanceTab`, and
  the AI coach's `summary` / `volume_by_muscle` analyses so its numbers match
  the charts.
- Deliberately *not* applied to: per-session summaries, per-exercise history
  (`exercise_progression`, `weekly_volume_by_exercise`, `ExerciseDetailModal`),
  streaks, and consistency — those answer "what did I do" and "did I show up",
  not "how much load did I take on".
- `available_exercises` surfaces the flag to the coach as
  `excluded_from_volume: true`; the `ai-coach` system prompt tells it not to
  count those exercises when discussing volume.

## Shareable links

A user can publish a completed workout, a template, or a program to a public URL
(`/s/:token`) that anyone can open logged out, and that a signed-in viewer can
import into their own library.

- **Snapshots are frozen.** `public.shares.payload` holds a self-contained copy
  of the item built by `src/utils/shareSnapshot.ts` — resolved exercise names,
  any custom-exercise definitions used, and (for programs) every referenced
  template embedded whole. Later edits to the source never reach an already-sent
  link; re-sharing overwrites the snapshot behind the *same* token.
- **The public page reads nothing owner-scoped.** `src/pages/SharedItem.tsx` is
  a wrapper-free route and must never call `useStorage` or any user-keyed hook.
  It renders from the payload alone.
- **`shares` is owner-only under RLS with no anon policy** — an anon `SELECT`
  would let anyone dump every share. The sole public read path is the
  `SECURITY DEFINER` function `get_shared_item(token)`, granted to `anon`, which
  returns a narrow column list (never `user_id` or `view_count`). A revoked
  share resolves with `revoked = true` and a null payload so the viewer sees
  "no longer available" rather than a not-found page.
- **A partial unique index** on `(user_id, kind, source_id) WHERE revoked_at IS NULL`
  keeps at most one live link per item, which is what makes the URL stable
  across updates while still allowing a re-share after a revoke.
- **Import remaps every id** (`src/utils/shareImport.ts`). Custom exercise ids
  are `custom-<row uuid>`, so the recipient's copies necessarily differ —
  missing ones are created (deduped by name) and each `exerciseId` is rewritten.
  An imported program is deliberately **not** activated: activating it would
  regenerate the viewer's `future_workouts`, which is destructive.
- Snapshot shape changes must bump `SHARE_SNAPSHOT_VERSION` in
  `src/types/share.ts`; the public page refuses payloads newer than it knows.
- Links preview with the generic RepVision card — this is a client-rendered SPA
  behind a catch-all rewrite, so per-share OG tags would need a prerender step.

## Known issues / deferred work

`.lovable/plan.md` contains an audit of pre-existing issues that were not part of the migration. Highest priority (per that doc):

- `useStorage.ts` does `select('*')` on `workout_sessions` with no pagination — silently loses rows above the 1000-row default limit.
- A fire-and-forget delete inside `setFutureWorkouts` callback has no error handling.
- 22 `as any` casts in `useStorage.ts` defeat the generated Supabase types.
- `ActiveSession.tsx` is 2,737 lines with 38 `useState` hooks — needs decomposition.
- `Index.tsx` is a 694-line god-router.

These are tracked but not yet fixed.

## Conventions

- Don't add comments that just describe what code does. Only add a comment when the *why* is non-obvious.
- Prefer editing existing files over creating new ones.
- Use the generated `Database` types from `src/integrations/supabase/types.ts` for new Supabase queries — don't introduce more `as any`.
- Tests live in `src/test/` and run via `npm test` (Vitest).
