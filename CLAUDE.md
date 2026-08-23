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
