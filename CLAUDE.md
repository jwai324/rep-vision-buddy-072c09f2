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
  contexts/           App-wide React contexts (notably ChatContext.tsx, which holds the AI chat loop)
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
    _shared/          Pricing, balance and request-bound helpers each function bundles
    ai-coach/         Streaming chat endpoint with tool use
    generate-program/ One-shot program builder, returns JSON
    exercise-gif/     Holds the RapidAPI key; the client sends only the exercise
    grant-tokens/     Purchase stub, never deployed (see "Deploying edge functions")
```

## Applying schema changes

New files under `supabase/migrations/` do NOT deploy on their own. After adding a migration you must either run `supabase db push` locally or apply it via the Supabase MCP server (`mcp__Supabase__apply_migration`), then regenerate the TypeScript types (`supabase gen types typescript --linked > src/integrations/supabase/types.ts`) so `Database` reflects the new schema. Shipping migration SQL without applying it produces silent client-side upsert failures against the missing columns.

## Deploying edge functions

`.github/workflows/deploy-supabase-functions.yml` deploys `ai-coach`, `generate-program` and `exercise-gif` on every push to `main` that touches `supabase/functions/**` or `supabase/config.toml`. Treat that as the deploy path, but **verify the run went green** — a client/server skew here fails *quietly*: the client keeps parsing a stream the old server no longer produces the same way. The 2026-05-18 → 2026-08 skew, for example, left `max_tokens` at 1024 and the `max_tokens` → `finish_reason: "length"` mapping unshipped, so every large template edit came back as "The proposal came back incomplete" instead of the real "too big, ask in smaller pieces". To deploy by hand (or after a red run) use `supabase functions deploy <name>`, or the Supabase MCP server, and check the deployed version.

That workflow took its project ref from a `SUPABASE_PROJECT_REF` secret that was never set, so from 2026-07-16 (when it was added) to 2026-09-06 all 20 of its runs died on "Cannot find project ref" and it deployed nothing, ever. It now reads the ref from `supabase/config.toml`, which is the single source of truth. Nothing was watching it fail: the error-triage routine's post-commit check is scoped to `ci.yml` by design, and this workflow never even runs on a triage commit because `supabase/functions/**` is on that routine's never-touch list. The routine's §4 health sweep now reports any red workflow on `main`.

**A merge to `main` that touches `supabase/functions/**` now deploys all three
functions (`ai-coach`, `generate-program`, `exercise-gif`).** That is new as of 2026-09-14 and it changes how to think about
server-side changes here: they are no longer inert until someone remembers, but
they also go live the moment the PR lands, with no separate gate. A migration a
function depends on must therefore be applied *before* the merge, not after.
Both gate RPCs (`begin_ai_turn` / `end_ai_turn`, from
`20260915182136_atomic_ai_turn_gate.sql` and
`20260915200720_ai_turn_slot_lifecycle_and_repriceable_ledger.sql`) are already
applied, so there is nothing to sequence today. The gate fails closed: a missing
RPC 503s every coach turn rather than letting it through unmetered.

Deploy state as of 2026-09-15, read from the API rather than assumed: `ai-coach`
is at version 5 and `generate-program` at version 4, both deployed from CI on
2026-09-14 and both current with `main`. Version numbers rot; confirm with the
MCP server's `get_edge_function` and diff against the file rather than trusting
this line.

`grant-tokens` has never been deployed and is deliberately left out of that
workflow — see the comment at the end of the file for why.

## AI integration

Both edge functions talk to Anthropic directly via `npm:@anthropic-ai/sdk`. The API key lives in `ANTHROPIC_API_KEY` (set as a Supabase function secret).

Note that `SYSTEM_PROMPT` and the other prompt blocks are template literals: a stray backtick in prompt prose ends the string and the file stops compiling, which surfaces only at deploy time.

### `ai-coach`

Streams a response that the client (`src/contexts/ChatContext.tsx`) parses as an OpenAI-style SSE stream. To avoid rewriting ChatContext, the edge function **translates Anthropic stream events into OpenAI-shaped SSE chunks** (see `translateStream` in `supabase/functions/ai-coach/index.ts`). When making changes to either side:

- Client expects `data: {"choices":[{"delta":{...},"finish_reason":null}]}` lines, terminated by `data: [DONE]`.
- Anthropic emits `content_block_start`, `content_block_delta` (with `text_delta` or `input_json_delta`), and `message_delta`. The translator maps those to the OpenAI shape.
- The client also sends tool results back in OpenAI shape (`role: 'tool'` messages with `tool_call_id`). `toAnthropicMessages` converts those to Anthropic's `tool_result` content blocks before sending.
- A `stop_reason` of `max_tokens` is translated to `finish_reason: "length"`. That matters because a tool call cut off mid-`input_json_delta` reaches the client as unparseable JSON; `parseAccumulatedToolCalls` in ChatContext flags those instead of letting them fall through validation as empty arguments. Tool JSON for a full-workout template runs to a few thousand tokens, so keep `MAX_TOKENS` well above that.

Template mutations come in two flavours, and the split exists for output-budget reasons: `edit_template` replaces the whole exercise list (so the model must re-send everything that should survive), while `add_exercises_to_template` appends only the new ones. Additions must use the append tool — a full re-send of a long template is thousands of tokens of tool JSON and is what pushes a reply into truncation. The client dedupes on `exerciseId` (`appendableTemplateExercises`) so a model that re-sends the list anyway can't duplicate rows.

A template proposal is applied against the template **as it is at Apply time**, not
the snapshot on the card. `edit_template` replaces the list, so `applyProposal`
refuses it (`templateChangedSince`, "changed since this was proposed") when the
template's name or rows differ from the ones it was built on — an edit made in
the builder in between used to be silently overwritten. `add_exercises_to_template`
re-derives instead: its additions are deduped against and appended to the
current rows, which is also what lets two append proposals from one reply both
apply. A proposal whose save is in flight is `status: 'applying'` (the card's
buttons are disabled; a second tap is a no-op), and it goes back to `pending`
when the write resolves `false`, so a refused delete or save never reads as
Applied. What the model may write is bounded at proposal time — `SetType`
outside the known list becomes `normal`, `sets`/`count` are 1–20 (they become
array lengths), a `create_program` day must name an existing template or
`rest`, and a `delete_template` obeys the same "used by a program" refusal as
the Templates screen (`templateDeleteBlockers` mirrors `templateUsedBy` in
`Index.tsx`; keep the two rules the same). Tests: `src/test/aiChatProposals.test.tsx`,
`src/test/chatProposalGuards.test.ts`.

A stream that dies after it has started (upstream billing, rate limit, dropped connection) is reported as a bare `data: {"error": "<plain sentence>"}` chunk with no `choices`. The client surfaces that sentence as the coach's reply — before this it skipped the payload and rendered an empty bubble, so an out-of-credits API key looked like the app silently doing nothing.

**Prompt caching** is enabled on the system prompt and on the last tool
definition (Anthropic caches everything up through the last `cache_control`
marker). The system array is **two blocks**, and the split is what makes the
cache hit at all: block 0 is `SYSTEM_PROMPT` plus the *stable* context keys and
carries the marker; block 1 holds the per-turn state and is deliberately
unmarked. A cache entry is an exact prefix match, so anything that changes
between turns inside block 0 rewrites the whole ~23k-token prefix at the
cache-write rate every single turn — which is what `active_session`,
`current_screen` and the rest were doing mid-workout, the coach's headline use
case.

`VOLATILE_CONTEXT_KEYS` in `ai-coach/index.ts` is that split, and it is a
**deny-list**: a key `buildContext` (`ChatContext.tsx`) adds later goes into the
*cached* block by default. Any new key carrying per-turn state has to be added
there, or the cache silently stops hitting with nothing failing.

**Concurrency and the slot.** Every metered turn takes an `in_flight` slot
through `begin_ai_turn` and must release it through `end_ai_turn`. In `ai-coach`
the release lives in `settleTurn` for a turn that actually streamed, and in the
handler's outer `finally` for every exit that never handed a body to the client
(`slot.handedOff` tells them apart); `generate-program` releases in its outer
`finally`. Getting this wrong is not a leak that cleans itself up: the five-
minute staleness reclaim is anchored to the *oldest* unreleased turn, so a
stranded slot costs the user their own coach until they stop using it.

**Billing survives a disconnect.** Metering is attached to the Anthropic stream,
not to the response body, and the body loop deliberately does **not** `break`
when the client goes away — breaking returns the generator, which aborts the
upstream, which makes `finalMessage()` reject, and the call goes unbilled after
Anthropic has already charged for it. Draining to the end is what makes a
disconnect billable; `stream.currentMessage?.usage` is the fallback if
`finalMessage()` still rejects.

**Request size.** `requestTooLarge` in `ai-coach/index.ts` bounds what a turn
may put in front of the model — message count and length, tool-result size,
and the serialized context — and runs *before* the credit gate, so a rejected
request never takes a concurrency slot. The gate holds a fixed reserve per
turn; without these limits a hand-built request could put an arbitrary amount
of input against that reserve. The ceilings sit well above what the client
sends (a typed message is capped at 500 characters; the context runs to about
100 KB, most of it the exercise library) so only a crafted request hits them.
If the client legitimately grows past one, raise the constant rather than
removing the check. `generate-program` has the same check in
`programRequestTooLarge` (exercise count and row size, every `userInputs`
value, and the whole), placed before `begin_ai_turn` for the same reason.

**Message shape.** The Messages API rejects two same-role turns in a row with a
400, and the client writes a second assistant message whenever a proposal is
applied or discarded. `toAnthropicMessages` merges consecutive assistant turns
(and consecutive user turns) for that reason, and the window is trimmed to start
on a user turn. Neither is cosmetic — a 400 here surfaces as "the reply failed
partway through" and repeats on every retry, because the window is the same.

**Turn lifecycle on the client.** Each `sendMessage` owns one
`AbortController` covering both fetches of the turn; `clearChat` and unmount
abort it, and a chunk that lands after the abort is dropped rather than
appended to a panel that was just emptied. A turn with no chunk for
`STREAM_INACTIVITY_MS` (60 s) is abandoned with a "stopped responding" reply —
without it a stalled connection left the coach spinning until a reload. Two
consecutive failures lock the coach out for `DISABLE_DURATION_MS`; the lockout
is `lockedUntil` (epoch ms) and **clears itself on a timer**, which the old
`consecutiveErrors >= 2` gate never did — its only reset was a successful turn,
which the gate itself prevented, so "will retry in 5 minutes" was a lie until
reload. A 413 (`requestTooLarge` on the server) is the message's fault, not the
service's, so it is shown and never counts toward the lockout. The counters are
read from refs because the error path runs long after the render that created
the closure. Clearing the chat ends the turn in flight but does **not** lift
the lockout — the trash icon must not be a one-tap way around it. The session
lookup (`auth.getSession`) runs inside the timer and the abort too: auth-js's
lock can hang, and that used to leave the coach loading until a reload. Tests:
`src/test/aiChatLockout.test.tsx`.

### `generate-program`

One-shot, non-streaming. Returns JSON. The system prompt has `cache_control: { type: "ephemeral" }` so consecutive program generations from the same user reuse the cache.

### Model

Default model is `claude-opus-4-7` (the most capable model in the Claude 4.x family). If responses are too expensive, swap to `claude-sonnet-4-6` — both edge functions have a `MODEL` constant at the top.

## Voice input (AI coach chat, bug report sheet)

`src/utils/speechToText.ts` drives the mic buttons in `AIChatBubble` and
`ErrorReportButton`, via `useSpeechToText`. It was rebuilt from scratch after two designs built on
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

Two details exist because of how browsers and React actually behave, and are
easy to undo by accident:

- `useSpeechToText` delivers `onEnd` inside `flushSync`. The engine clears its
  transcript (a synchronous store update) and then hands the words over (a
  setState from a browser event or timer, which React would commit later and
  separately). Without `flushSync` there is a commit with the words in neither
  place, and a Send tapped in that instant goes out without them. The engine
  therefore never hands words over from inside a React effect — `stop()`
  between sessions finishes on a fresh task for exactly that reason.
- A session opens `RESTART_DELAY_MS` after the previous one closed, whether
  it was told to abort (a tap right after a send, a double tap) or ended by
  itself (chaining, and a run started from inside `onEnd` — which is how the
  bug-report sheet moves the mic between its boxes). Chrome for Android tears
  the native recognizer down asynchronously, after `onend` as well, and
  reports a start that races it as `not-allowed`, which would otherwise
  surface as a false "microphone blocked" toast. `lastClosedAt` in the engine
  is recorded on both paths for that reason.

Browser facts the design leans on (verified in Chromium and WebKit source):
Chrome and WebKit only ever append finals and keep at most one interim, always
last; a single-utterance session ends after 0.5–1 s of silence on desktop
Chrome (8 s `no-speech` if nothing is said) and after the utterance on Android
and Safari 17+; WebKit never emits `no-speech` and has no silence timer of its
own, so the engine's 10 s backstop is what releases the mic on iPhones.

Trade-offs to know: there is a short gap between chained sessions, so words
spoken in the instant after a pause can be missed (pause, then continue), and
Android plays its start sound at the top of every session. Both are the price
of a mode that cannot double a word.

The bug-report sheet dictates into both of its boxes on the same rules, and
`withSpoken` / `SPEECH_ERROR_MESSAGES` are shared with the chat so the two say
and compose the same thing. One engine serves both boxes, because the browser
runs one recognizer at a time and a single run is what keeps a sentence from
being split across two of them: `voiceField` says which box the run writes
into, and it only changes once a run has handed its words over — a mic tapped
on the other box ends the run first and is queued (`queuedField`) until the
engine is idle *and* its transcript is empty, which is the point at which the
words have landed. Typing takes over from talking in the box being dictated
into only; typing in the other one leaves the run alone. Send banks the spoken
words as ordinary text before dropping the run, so a failed send keeps
everything that was on screen.

Tests: `src/test/speechToText.test.ts` (engine, including seeded browser
"personalities" that replay, duplicate and cumulate),
`src/test/aiChatSpeech.test.tsx` (panel integration, including StrictMode) and
`src/test/errorReportSpeech.test.tsx` (both report boxes, including the
hand-over when the mic moves between them).
`src/test/helpers/fakeSpeechRecognition.ts` is the shared fake.

## OAuth

Native Supabase OAuth (`supabase.auth.signInWithOAuth`) — see `src/pages/Auth.tsx`. To enable Google sign-in, configure the Google provider in the Supabase dashboard (Authentication → Providers) with your OAuth client ID and redirect URI.

## Supabase project setup runbook

If you need to provision a fresh Supabase project (e.g., moving off the old `wekcpvqydhaaupjfkkno` instance):

1. Create the project at https://supabase.com/dashboard. Pick a region close to your users.
2. Install the Supabase CLI: `npm install -g supabase`. Log in: `supabase login`.
3. Link locally: `supabase link --project-ref <new-project-ref>`.
4. Push the schema: `supabase db push` (applies everything under `supabase/migrations/`).
5. Set the function secrets. The Anthropic key is required; the RapidAPI key
   is optional and the exercise-GIF feature is simply off without it:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set EXERCISE_GIF_API_KEY=...
   ```
6. Deploy the three live edge functions (the same set the deploy workflow ships):
   ```bash
   supabase functions deploy ai-coach
   supabase functions deploy generate-program
   supabase functions deploy exercise-gif
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

| Secret                       | Used by             | Purpose                                            |
| ---------------------------- | ------------------- | -------------------------------------------------- |
| `ANTHROPIC_API_KEY`          | `ai-coach`, `generate-program` | Anthropic API key                       |
| `EXERCISE_GIF_API_KEY`       | `exercise-gif`      | RapidAPI key for exercise GIFs; unset = feature off. Mint a fresh key: the old `VITE_` one is in every past bundle |
| `METERING_BYPASS_USER_IDS`   | `ai-coach`          | Operator metering bypass; unset = off (see below)  |
| `GRANT_TOKENS_SECRET`        | `grant-tokens`      | Header gate on the Phase 1 purchase stub           |
| `SUPABASE_URL`               | Auto-set            |                                                    |
| `SUPABASE_SERVICE_ROLE_KEY`  | Auto-set            |                                                    |

### The AI coach metering bypass ("god mode")

The switch is **off by default and lives entirely server-side**. `ai-coach`
grants an unmetered turn only when the request asks for one *and* the
authenticated user id appears in the `METERING_BYPASS_USER_IDS` function secret
(comma- or whitespace-separated). With the secret unset, nobody gets it.

The ask itself is not a secret and is not treated as one: `god_mode` in the
request body and the `god mode 3247` phrase both ship in the client bundle, and
this repository is public. They are a convenience trigger, nothing more. Before
this split, either one was sufficient on its own, which meant any signed-up user
could run `claude-opus-4-7` on the project's API key for free.

```bash
supabase secrets set METERING_BYPASS_USER_IDS=<your-auth-user-id>   # switch on
supabase secrets unset METERING_BYPASS_USER_IDS                     # switch off
```

Never move this decision back to anything the client sends, and never put the
allowlist in a `VITE_` variable — Vite inlines those into the public bundle.

### No secret ever goes in a `VITE_` variable

The same rule, stated generally, because it has been broken twice. Vite bakes
every `VITE_*` value into the shipped JavaScript, so a key placed there is
readable by anyone who opens the bundle — the exercise-GIF RapidAPI key shipped
that way until 2026-09-17. Any third-party key is held as a Supabase function
secret and used from an edge function (`exercise-gif` is the template: the
client sends the one input it controls, the function holds the key). `.env`
carries only the Supabase URL and the publishable key, both of which are public
by design.

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

- **A load is only trusted when every query came back clean.** postgrest-js
  resolves `{ data: null, error }` rather than throwing — for a 5xx, an expired
  token and an offline fetch alike — so nothing reaches the `catch`. The load
  checks `.error` on all seven queries and only then sets `loadedOk`. Two things
  gate on that flag rather than on `loading`: the localStorage snapshot write
  (allowed also when the screen was painted from the cache, since that content is
  already trusted) and the two effects that write back to the database — the
  program-day repair and the streak-adjustment clear. Gating those on `!loading`
  is what let a failed sessions query read as "the streak broke" and clear a real
  adjustment permanently. Tests: `src/test/storageLoadErrors.test.tsx`.

If you add a field to `useStorage`'s state, add it to `CachedStorage` too, or
it will be blank on a hydrated open until revalidation lands. Changing the
shape of anything cached means bumping `CACHE_VERSION`.

**Sign-out clears everything that belongs to the user.** The snapshot and the
pending-template queue are keyed by user id and clear themselves, but the
in-progress workout cache and the builder, chat and bug-report drafts are not.
`src/utils/localDrafts.ts` lists every such key; a new draft key added
anywhere in the app belongs in that list, or the next account on a shared
phone inherits it — for the session cache, that meant resuming the previous
user's half-finished workout and being able to save it into their own history.
The clearing runs from the **`SIGNED_OUT` event** in `AuthContext`, not from
the Sign Out button: auth-js also ends the session by itself when a refresh is
refused — which is what signing out on any *other* device does to this one,
the default scope being global — and it emits the event in every open tab.
The button waits for `auth.signOut()` to succeed before clearing anything;
offline it resolves with an error and keeps the session, and wiping the
workout first would have lost it for nothing.

**`saveProgram` and `setActiveProgram` resolve `false` on failure** and the
two program builders wait for that answer before clearing their draft, showing
"saved" or leaving the screen. They used to do all three first, so a failed
upsert lost the whole program — and, for the AI builder, the credits spent
generating it — and then activated a program id that was never written.

**Regenerating a program's calendar never touches its history.** `saveProgram`
rewrites `future_workouts` only from today forward and only for rows not yet
completed; past and completed rows carry the done flags, recovery activities
and hand-shifted dates that *are* the program's record. The new rows go in
before the old ones come out, so a failed insert leaves the previous schedule
standing rather than an empty server behind a screen still showing rows. The
old rows are retired by `created_at < ` the timestamp the server stamped on the
new ones — never by a list of the new ids, which grew with the program until
the URL was refused (48 weeks of daily rows is a 13 KB query string), and a
refused delete doubled every date. A workout already completed on or after
today is not scheduled a second time beside its completed row.

**A write that lands while a load is in flight wins.** Every write bumps
`writeSerial`; a load that started before a write and resolved after it is
discarded and run once more (at most twice), instead of painting rows that are
older than the screen — which then got pushed back to the server by the next
preferences save.

**Settings and profile writes send only the changed columns.** An upsert with a
partial payload updates just those columns on conflict, so a phone and a laptop
stop overwriting each other's newer values with whatever each had cached.
`updatePreferences` builds its payload from the keys it was given (plus the
streak-adjustment pair whenever the mode or target changes, since those are
derived from it) and never includes `active_program_id`, which has its own
write path.

`saveSession` resolves `false` rather than throwing when the write does not
land, so the caller can keep the summary screen and the local session cache
alive for a retry; every call site in `Index.tsx` awaits it and bails on false.
Writes to the *same* session id are chained, not raced — the summary's
recovery-activity chips fire one save per tap and two in flight at once can
arrive out of order, leaving the row holding the earlier one. The Save buttons
themselves are covered by a single in-flight guard in `Index.tsx` (`guardedSave`)
because a template and a rest-day session are built fresh per tap, so a second
tap would write a duplicate row rather than retry the first.

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
resurrects it. `saveTemplate` and `deleteTemplate` also **wait for the replay
in flight** (`pendingFlush`) before writing: a queued version is older than
anything the user does after reopening the app, and its upsert landing second
silently replaced the newer edit. That `await` is not a needless delay.

## Program frequencies are validated at every door

`src/utils/programFrequency.ts` is the one place a `DayFrequency` is checked
(`sanitizeFrequency`) and the one place a frequency is turned into dates
(`frequencyOccurrences`, with `programOccurrences` / `programOccurrencesOn` on
top of it). Both exist because the same value arrives from four sources that
never agreed — the builder, the coach's `create_program` tool, a shared program
and a restored backup — and the last two carry whatever was in the file. An
`everyNDays` interval of 0 was an infinite loop (a denial of service by share
link); a monthly day of 29–31 overflowed a short month and then drifted the
whole schedule by a day or three for good.

**Every reader walks dates through that one helper**: the scheduler
(`generateFutureWorkouts`), the dashboard's week strip, the monthly calendar
and the day-tap helper in `useScreenHelpers`. The first fix validated the
scheduler alone and left the other three with their own loops, so a program
saved before validation existed still hung the home screen. Do not add a
fifth loop. The program editor's calendar preview is `programOccurrences` over
the draft, the same call `saveProgram` schedules from — its own loops used to
drop today's every-N-days occurrence, so the preview and the saved calendar
disagreed. `saveProgram` also writes sanitized days and the load-time repair
re-saves a stored program whose days sanitize differently, so the database
heals itself. An invalid frequency makes the day *unscheduled*, never dropped;
weekday 7 is read as Sunday (an older builder's numbering), the same mapping
the repair uses.

## Screens live in the browser's history

`useScreenHistory` (`src/hooks/useScreenHistory.ts`) is `Index.tsx`'s screen
state. Each change of screen *type* pushes one history entry, tagged with its
depth and a per-load id, and `popstate` restores the screen beneath, so the
Android Back button goes back a screen instead of leaving the site. In-app
navigation maps onto the browser's own history wherever it can: going home
unwinds to the root entry (so Back at home still exits rather than replaying
the trip), and going to a screen type that is already in the stack unwinds to
it. That second rule is what keeps "save, back to the list" from leaving the
editor in the history — Back used to reopen it holding the pre-edit session,
whose Save then overwrote the edit. A same-type update (a detail screen
swapping its payload) changes state in place and adds nothing.

Three things about it are easy to get wrong:

- **The screen changes synchronously; the browser catches up.** `history.go`
  lands on a later task, and the popstate it fires is recognised by depth and
  ignored. Nothing in the app waits on it, so a cache write or a Finish tapped
  in that window runs against the new screen, not the one on its way out. Two
  navigations in one tick are still not supported: the second computes against
  a browser position the first has not reached.
- **A restored screen goes through `restore`.** The stored object is whatever
  the screen held when it was left; the rows have moved on. `Index` re-reads a
  session, scheduled workout, template or program by id and returns `null` for
  one that no longer exists, which Back skips. A restored `activeSession` is
  marked `resumed` when its cache is there and dead when it is not — a screen
  restored without `resumed` mounted a blank workout over the real cache.
- **`onUserBack` can keep the screen.** Returning `true` puts the history entry
  back; `Index` uses it so Back with the summary open closes the summary (the
  user un-finished the workout) rather than minimizing a finished one. Back out
  of a live workout otherwise **minimizes** it — the cache is untouched and the
  bar appears on the screen beneath. A Forward press is undone, since the
  screens above were discarded.

Deep links and reload survival are deliberately out of scope: a reload starts
at the root, and entries from an earlier page load pop back to it.

## Editing a past workout is not a workout

`ActiveSession` in edit mode (`editSession` set) must stay out of everything
that belongs to a live session: it does not register with the session
controller (the coach saw a fake `active_session` and its tools rewrote
history), re-ticking a set gets a no-op `startTimer` (no sound, OS
notification or permission prompt), the rest bars between sets and between
exercises are not rendered at all (they took the live `startTimer`, so the
no-op never reached them), and the fields the edit screen has no
control for — `location`, `isRestDay`, `recoveryActivities` — ride through from
the session being edited. Duration is written back only when the minutes field
was actually changed; the field shows whole minutes, and writing it back
unconditionally truncated 32:40 to 32:00 on every edit. `startedAt` likewise
is rebuilt from the date and HH:mm fields only when one of them changed: the
unconditional rebuild dropped the seconds and moved a workout that began
before midnight (startedAt on the 9th, date on the 10th) forward a day on
every save. Saving an edit passes `markScheduled: false`, so correcting a
record never ticks off whatever is scheduled on that date, and the coach sees
an `activity` screen, not an `active_workout`.

A live workout keeps two clocks. `startTime` is the timer's anchor and is
shifted forward on every resume so elapsed stays continuous; `trueStart`
(cached as `trueStartTimestamp`) is when the workout began. `startedAt` and the
session's date come from `trueStart`; duration is `now − startTime` while
running and the frozen figure while paused, so a pause is never counted.

## The session cache belongs to one workout

`ActiveSession` rebuilds a workout from `ActiveSessionCache` — blocks, name,
elapsed timer, `templateSnapshot`. That cache is only ever valid for the workout
it was written for, and two rules keep it that way:

- **`Index.tsx` hands the cache only to a screen that is resuming one.** The
  `activeSession` screen carries a `resumed` flag, set by the cold-start restore
  (`restoredSessionScreen`) and by `handleExpand`; `cachedSession` is
  `screen.resumed ? getSessionCache() : null`. Reading `getSessionCache()`
  unconditionally is how starting Push Day while Leg Day was minimized mounted
  Leg Day's exercises and timer under Push Day's identity — and then offered to
  overwrite Push Day with them, and marked Push Day's scheduled entry done.
- **`ActiveSession` refuses a cache whose `templateId` does not match its own.**
  A backstop for any path that forgets the first rule.
- **The session's error boundary recovers from the cache.** Try Again remounts
  the screen with `resumed` set; discarding is a separate two-tap action on the
  same fallback. Try Again used to clear the cache — the recovery button was the
  destructive one.

Starting a new workout while one is in progress now asks first
(`openSession` → the confirm dialog), keyed on the cache rather than on
`minimizedSession`, because desktop sidebar navigation and the coach's credits
link used to change screen without minimizing — leaving a live session with no
bar and no way back short of a reload. Both now minimize first. Tests:
`src/test/activeSessionStaleCache.test.tsx`.

## The stopwatch set is keyed by position

`runningSet` and `countdown` in `ActiveSession` hold a block index and a set
index into `blocks`, and the mutations in `useBlockMutations` move rows under
them: 'Add Warm-up Sets' prepends a row, deleting a set or an exercise pulls
the rows below it up, and drag-reordering permutes the blocks. Every such
mutation reports the move through `onSetIndicesShifted` /
`onBlockIndicesShifted` (`handleDragEnd` does the same for reorders), and
`ActiveSession` remaps the two states — a row that is gone ends what was on
it. Before this, Stop wrote the set's time and completion to whichever row had
slid into the index. A new mutation that inserts, removes or reorders rows
must report through the same callbacks. The rest timer's id and the
`restRecords` keys are index-keyed the same way (`useSessionRestTimer`), and
`ActiveSession` forwards every remap to `remapTimerIds`, so the rest bar and
the rest chips move with their rows too; a drop-row remap
(`onDropIndicesShifted`) covers a stopwatch running on a drop.

## The rest timer outlives the screen

`src/utils/restTimerScheduler.ts` holds everything about a rest that must keep
running when `ActiveSession` unmounts: the worker that keeps time in a hidden
tab, the scheduled sound and vibration, and the "Rest complete" toast and OS
notification. `useSessionRestTimer` owns only the React state and hands the
scheduler the rest's identity (`<timer key>@<startedAtEpoch>`, so an extend
is a new rest and a remount of the same one is not). Before this the hook
owned all of it, so minimizing a session — which unmounts the screen — killed
the rest's sound, notification and worker, and its worker's "done" raced the
throttled completion timeout and cancelled the notification it was racing.

Rules that keep it correct:

- **Completion is signalled once per rest, from `recalcRestSchedule`.** The
  worker's "done", the completion timeout and the visibility catch-up all route
  through it; whichever lands first fires, the rest are no-ops.
- **A cross-tab `storage` event is applied only when its timer or records
  actually differ** (`sameTimer` / `sameRecords` in `useSessionRestTimer`).
  Setting the freshly parsed objects as they come re-ran this tab's cache
  writer, whose write was the other tab's next storage event: two tabs on one
  workout rewrote the cache every half-second and the last writer owned the
  blocks.
- **`ensureRestSchedule` is a no-op for the live key.** A remounting hook
  re-attaches rather than restarting; `releaseRestSchedule` is the only
  teardown. It is called by skip/pause/replace, by `clearSessionCache`
  (the workout is over), by sign-out, and by the hook's unmount only when no
  session cache exists (a minimized session keeps its rest). As a backstop, a
  rest scheduled while a cache existed polls for that cache once a second and
  releases itself when it is gone, so a workout discarded from the minimized
  bar cannot ring later.
- **Hide Timers silences the whole feature**: no sound, no vibration, no
  permission prompt, no toast, no OS notification (`setRestTimerHidden`). The
  old hook silenced the sound only and still prompted for notification
  permission and toasted; that was an oversight, not a design. `Index` sets it
  from the preference, because Settings is reachable while a session is
  minimized and the session hook is unmounted then; the hook sets it too for
  the in-session toggle.
- **A pending cache write is flushed on unmount while the cache exists.** A
  rest started or skipped in the last half-second before minimizing was in the
  scheduler but not in the cache, and the screen came back without it.
- **Notifications on Chrome for Android go through the service worker.** Its
  page-level `Notification` constructor throws, so `main.tsx` registers
  `public/sw.js`, which handles nothing but the notification click. It
  deliberately has no fetch handler and no cache; keep it that way, or it
  starts sitting between the app and the network.

Tests: `src/test/restTimerScheduler.test.ts` and `src/test/restTimerHook.test.tsx`.

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

## Exercise demonstration clips

Every exercise can carry a short looping demonstration clip (`ExerciseClip`,
at the top of the exercise detail modal). The media lives in the public
`exercise-clips` Storage bucket and the map in `public.exercise_clips`, one
row per exercise keyed by the app-side exercise id. There is no `exercises`
table (the built-in library is bundled), so `exercise_id` is a text key that
the ingest validates against `EXERCISE_DATABASE`, not a foreign key.

Each clip exists in two encodes, and **`CLIP_MODE` in
`src/config/exerciseClips.ts` decides which one the app serves**: `'opaque'`
(the H.264 mp4, figure flattened onto white, rendered on an explicit white
card) or `'alpha'` (the VP9 webm with an alpha channel, over a transparent
container that follows the theme). The default is `'opaque'` because it
renders correctly everywhere; `'alpha'` is a one-line flip once VP9 alpha has
been verified on iOS WKWebView, which is untested. The two are never offered
as sibling `<source>` elements: a browser can decode VP9 and still ignore the
alpha channel, which renders an opaque black box with no error to fall back
on, so the choice has to be explicit.

The component reserves its box from the row's `width`/`height` before anything
loads, shows the poster (a transparent WebP) under `prefers-reduced-motion`
and on any media error, and never leaves a dead black rectangle. The detail
modal reserves a 16:9 placeholder while the row is looked up and falls back to
the legacy `ExerciseAnimation` for an exercise that has no clip yet.

**Dev override.** In a dev build (`npm run dev`, or `npm run build:dev` for a
Capacitor test build) `?clipmode=alpha|opaque|reset` on the page URL, or the
toggle under Settings → Developer, overrides `CLIP_MODE`; the choice is
persisted in localStorage so it survives navigation. `import.meta.env.DEV`
gates it, so a production build compiles the override out (the strings are
absent from the bundle). Tests: `src/test/clipMode.test.ts`,
`src/test/exerciseClip.test.tsx`.

**Readable, not enumerable.** The bucket is public-read but has no
`storage.objects` policy: objects are served by exact path, while list and
search go through RLS and find nothing. Object names carry a content hash, and
the table, the only map of paths, is readable by `authenticated` only. Do not
add a SELECT policy on `storage.objects` for this bucket, and do not grant the
table to `anon`; the vendor licence covers use in the app, not redistribution.

**Ingest.** `scripts/clips/` (README there) encodes a vendor directory with
`encode.sh`, extracts posters, uploads and upserts. It is resumable stage by
stage, resolves filenames to exercises by the explicit `clip-map.csv` first and
exact name match second, and writes everything it will not decide to
`review.tsv`. It needs the service role key exported in the shell; it is
one-time tooling and not in the bundle. Tests: `src/test/clipNaming.test.ts`.

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

**Band levels are stored raw.** A band set's weight field holds its level
(1–6), never a mass, in sessions and templates alike: the finish path and the
edit path go through `inputToTargetWeight` / `targetWeightToInput`, which skip
the unit conversion for band work. Rows saved before September 2026 by an lbs
user hold the level divided by 2.20462 instead (level 6 = 2.72), so every
reader of a band level goes through `storedBandLevel`, which maps either
encoding back to the level. Never hand a stored band weight straight to
`getBandLevelShortLabel` — that is how the Previous column, the summary and
the strength chart came to say "Level 2.72".

## Supersets are links, not a set type

A superset is `supersetGroup` shared by two or more exercises; it is made from
the exercise menu ("Create Superset" → `SupersetLinker`) in the template
builder and the live session alike, and shown the same way on both, plus the
summary, through `supersetColorClass`. `setType: 'superset'` is only the echo
of that link (`linkedSetType`), never the link itself — the builder used to
offer it as a per-exercise pill, which linked nothing and carried nothing into
a workout.

Older templates carry the setType-only form, so `resolveTemplateSupersets`
(`src/utils/templateSupersets.ts`) runs wherever a template is read into an
editor or a session: explicit groups are kept, an ungrouped run of two or more
superset-typed exercises is **cut into pairs** (an odd run ends in a trio), and
a lone one is a plain exercise. Cutting matters — the coach writes "pair these
up" as a run of six or eight, and one group of eight renders as a whole workout
in a single colour. A group only one exercise is left holding is cleared
(`withoutLoneSupersets`), which is what heals a partner deleted in the builder
or skipped in a workout that then updates its template. The session's
update-template snapshot is taken from the resolved list too, so a superset
template run as planned never prompts with a phantom "superset change".

`supersetInfo(items, idx)` in `src/types/activeSession.ts` is the single source
for how a superset is *shown*: which pairing it is (A, B, C… by order of
appearance, never by the stored id, which goes sparse), where the exercise sits
in it, how many it links, and the tint. The live session, focus mode, the
template builder, the linker and the summary all read from it, and
`SupersetBadge` renders it as "Superset A · 1 of 2". Group ids are internal.

Both edge functions can now express a link: `supersetGroup` is in the ai-coach
template tool schemas, and `superset_group` is described (not hard-coded to
null) in the generate-program prompt. `carryTemplateOnlyFields` in
`ChatContext.tsx` re-attaches `supersetGroup` and `targetWeight` from the row
being replaced on an `edit_template`, because the model can omit what it wasn't
asked to change — without it a wholesale edit unlinked every superset in the
template.

## The program editor and the shared template editor

`ProgramBuilder` is laid out like `ProgramView`: one tile per day holding the
day's fields, with a footer strip that opens the day's template for editing in
place. The exercise list is `TemplateExerciseEditor`, which the standalone
`TemplateBuilder` renders too, so the two surfaces cannot drift. The editor is
controlled — it holds no template state and expresses every edit as a
functional update through `onChange` — which is what lets the program editor
keep one draft per *template id* and show it in every tile that uses the
template. It resolves exercise names through the lookup at render time rather
than writing them back into the blocks, because a write-back registers as an
edit to an owner that treats any change as unsaved.

A template edited inside a tile is saved from that tile (`onSaveTemplate`,
wired to `useStorage.saveTemplate`), not by Save Program: templates are shared
by id, so the save reaches every program that uses the template, and the
expanded tile says so. Save Program refuses while a referenced template still
has an unsaved draft, rather than dropping or saving it silently. The editor's
localStorage draft (`program_builder_draft`) carries the template drafts too,
keyed to the program; the back arrow clears it, as Cancel did.

The editor shows **one target row per exercise and a set-count stepper**,
because that is what a template can hold: `TemplateExercise` has a set count
next to a single reps/weight/RPE, and `blockToExercise` reads only `sets[0]`.
Every edit is written to every row of the block and the stepper clones the
row, so a draft's rows can never disagree with what will be saved. The old
per-set rows were how "clear set 3 to mark it to failure" looked like an edit
and saved nothing.

The exercise picker and the superset linker open as fixed full-screen overlays
from inside the editor, because a tile cannot hand over the whole screen the
way the old builder's early return did. The block conversions live in
`src/utils/templateBlocks.ts`. Tests: `src/test/programBuilder.test.tsx`.

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
  the charts. The coach counts the way the charts count, too:
  `volume_by_muscle` is working sets only (no warm-ups, like the Dashboard's
  Weekly Sets and the Volume tab's body-part lines) and `frequency` counts a
  body part once per session (like the Frequency tab), not once per exercise.
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
- **`sharedBy` is never an email address.** Sign-up seeds `display_name` from
  the email, so an account that never renamed itself would put its address on
  a public page. `publishableSharedBy` drops anything that could be one, at
  share time in the snapshot builders and again on read in `SharedItem`
  (payloads frozen before the guard still carry it). Route any new reader or
  writer of `sharedBy` through it.
- Snapshot shape changes must bump `SHARE_SNAPSHOT_VERSION` in
  `src/types/share.ts`; the public page refuses payloads newer than it knows.
- Links preview with the generic RepVision card — this is a client-rendered SPA
  behind a catch-all rewrite, so per-share OG tags would need a prerender step.

## Error reports and the triage routine

Every signed-in screen has a small bug handle hanging from the top centre of
the viewport (`src/components/ErrorReportButton.tsx`). It opens a bottom sheet
that files a row in `public.error_reports` with the screen, route, deployed
commit, device info, and the last 20 console errors. The commit comes from
`__APP_VERSION__`, which `vite.config.ts` injects from Vercel's
`VERCEL_GIT_COMMIT_SHA` (local builds say `dev`); the console errors come from
`src/utils/consoleErrorBuffer.ts`, installed in `main.tsx` before the first
render. The handle sits at top centre because every screen header puts its
controls at the left and right edges and starts at or below 16px, so a 24px
strip in the middle is free on all of them; the AI coach owns the bottom-right.

The table is a queue, not a log. A scheduled Claude Code Routine ("RepVision
error triage", nightly around 03:30 ET) follows
`.claude/skills/error-triage/SKILL.md`: obvious defects are fixed directly on
`main` behind the full gate (lint, typecheck, tests, build, then the CI
workflow on the pushed commit) and their rows are **deleted**; anything else is
parked as `needs_review` with a note the user sees in-app under "Your open
reports", and listed on the Notion page "🐛 RepVision Error Reports" (child of
"💠 AI Exercise App") for the Morning Brief to pick up. Answer a parked item by
adding a nested `Decision:` bullet under it in Notion; the next run treats that
as the spec, and `Decision: drop` deletes the row. Users have no UPDATE or
DELETE policy on the table — the routine writes with the service role through
the Supabase MCP server.

`.github/workflows/ci.yml` runs the same gate on GitHub for every push to
`main` and every PR. The routine waits for it and reverts a fix whose run goes
red, so keep the workflow's steps identical to the local gate.

## Known issues / deferred work

`docs/audit-2026-09.md` is the current audit (commit efffcd8): 193 verified findings,
each traced to a file and line by one reviewer and re-checked by another, with the
critical and high ones also given to a reviewer told to disprove them. Start there.

**All 4 critical and all 18 high findings are fixed** on `claude/code-audit-859aow`,
a second pass closed the 20 highest-exposure items from the backlog, and a third
pass (`claude/code-audit-batch-one`) closed 69 more that were unambiguous
defects. The audit's status note lists all three passes, names the 64 rows still
open, and says which ship where.

Two facts from that audit change how you work in this repo:

- **The repo's migration filenames no longer match the live migration history.** Eight
  were applied through the Supabase MCP server, which stamps its own version. Running
  the documented `supabase db push` against the linked project will fail until the
  versions are repaired. When you apply through the MCP server, read the version it
  recorded and rename the local file to match, as
  `20260915170641_lock_down_token_credits.sql`,
  `20260915182136_atomic_ai_turn_gate.sql` and
  `20260915200720_ai_turn_slot_lifecycle_and_repriceable_ledger.sql` do.
- **Token prices were 3x too high until 2026-09-15.** `_shared/pricing.ts` carried the
  Opus 4.1 rates ($15/$75 per MTok) rather than Opus 4.7's ($5/$25). Rates now live in
  `RATES_BY_MODEL`, keyed by model id, so a `MODEL` swap with no entry bills at the
  highest known rate and logs loudly instead of silently under-charging.

  `token_ledger` now records `model` and the four token counts per row, so the next
  rate change is correctable. Rows written **before 2026-09-15 have those columns
  null** and cannot be re-priced from the ledger — treat every pre-2026-09-15 balance,
  allowance and cost figure as 3x inflated. `user_ai_usage` does hold per-day token
  counts going back further, so a correction pass is possible there; nothing has run
  one, and `ai_usage_daily_summary.cost_usd` still overstates historical spend 3x.

Still open from the audit's own high-severity list, as things the fixes could not
close on their own:

- **`grant-tokens` is an uncapped credit faucet.** Its only gate is a static
  `x-admin-secret` header, it credits whatever `target_user_id` the body names, and
  `micros` has no ceiling. It has never been deployed and is deliberately absent from
  the deploy workflow, so there is no live exposure — but it is one deploy away from
  being one. Before it ships it needs to verify the caller's JWT, drop
  `target_user_id`, bound the amount, and grant only from a verified receipt.
- **Balances consumed at the 3x rate were never corrected.** Nothing has re-priced
  them; see the token-price note above for what the data does and does not allow.

**Deleting something still referenced is refused, not cascaded.** A template a
program schedules (or a manual scheduled workout points at) and a custom
exercise a template uses cannot be deleted from their screens; the dialog names
what references them. `Index.tsx` computes `templateUsedBy` / `exerciseUsedBy`
from loaded state. Cascading was the alternative and was rejected: the
reference is a plan the user made, not a row to clean up.

`.lovable/plan.md` is the older audit and is now partly stale: the `as any` casts are
gone, `ActiveSession.tsx` is about 1,750 lines rather than the 2,737 it quotes (measure
with `wc -l` rather than trusting either figure), and the unpaginated
`workout_sessions` read is now an explicit, documented 500-row cap. Its two surviving
items are `Index.tsx` (about 970 lines, still a god-router) and the decomposition of
`ActiveSession.tsx`.

## Conventions

- Don't add comments that just describe what code does. Only add a comment when the *why* is non-obvious.
- Prefer editing existing files over creating new ones.
- Use the generated `Database` types from `src/integrations/supabase/types.ts` for new Supabase queries — don't introduce more `as any`.
- Tests live in `src/test/` and run via `npm test` (Vitest).
