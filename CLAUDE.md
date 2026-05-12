# CLAUDE.md

Project guide for Claude Code working in this repo.

## What this app is

RepVision is a workout tracking PWA. The user plans workouts (templates → programs), runs live sessions, and can talk to an AI coach that edits their templates/programs/active session through tool calls.

## Stack

- **Frontend**: Vite + React 18 + TypeScript, Tailwind + shadcn/ui, React Router (hash-based), TanStack Query
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

## AI integration

Both edge functions talk to Anthropic directly via `npm:@anthropic-ai/sdk`. The API key lives in `ANTHROPIC_API_KEY` (set as a Supabase function secret).

### `ai-coach`

Streams a response that the client (`src/contexts/ChatContext.tsx`) parses as an OpenAI-style SSE stream. To avoid rewriting the 680-line ChatContext, the edge function **translates Anthropic stream events into OpenAI-shaped SSE chunks** (see `translateStream` in `supabase/functions/ai-coach/index.ts`). When making changes to either side:

- Client expects `data: {"choices":[{"delta":{...},"finish_reason":null}]}` lines, terminated by `data: [DONE]`.
- Anthropic emits `content_block_start`, `content_block_delta` (with `text_delta` or `input_json_delta`), and `message_delta`. The translator maps those to the OpenAI shape.
- The client also sends tool results back in OpenAI shape (`role: 'tool'` messages with `tool_call_id`). `toAnthropicMessages` converts those to Anthropic's `tool_result` content blocks before sending.

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
