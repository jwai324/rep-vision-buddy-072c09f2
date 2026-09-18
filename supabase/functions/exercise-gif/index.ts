import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// Looks up an exercise's demonstration GIF on RapidAPI on the client's behalf.
//
// The client used to call RapidAPI directly with the key inlined from a
// VITE_ variable — Vite bakes every VITE_ value into the public bundle, so any
// configured key could be lifted from the shipped JavaScript and billed by
// anyone. The key now lives here as a function secret, the same way
// ANTHROPIC_API_KEY does, and the only input a caller controls is the
// exercise name. A signed-in user is required, and each user gets a bounded
// number of upstream lookups per hour, so a free sign-up cannot run the
// RapidAPI quota down. The limit is per isolate and in memory — a best-effort
// brake, not an accounting system; the client caches every answer for the
// page's lifetime, so a real user never comes near it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const RAPIDAPI_HOST = "workoutx-exercise-api-with-gif-animations.p.rapidapi.com";
const MAX_NAME_CHARS = 120;

// One lookup per exercise name per isolate. The client caches too; this keeps
// a warm isolate from re-billing the upstream for the same name across users.
// Bounded, because every unique name a caller invents is an entry: the oldest
// go first (Map keeps insertion order).
const MAX_CACHE_ENTRIES = 2_000;
const cache = new Map<string, string | null>();

const MAX_UPSTREAM_PER_USER_PER_HOUR = 120;
const HOUR_MS = 60 * 60 * 1000;
const upstreamCalls = new Map<string, { windowStart: number; count: number }>();

function remember(key: string, gifUrl: string | null): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, gifUrl);
}

// True when this user may make another billed upstream call now.
function allowUpstream(userId: string): boolean {
  const now = Date.now();
  const entry = upstreamCalls.get(userId);
  if (!entry || now - entry.windowStart >= HOUR_MS) {
    if (upstreamCalls.size >= MAX_CACHE_ENTRIES) upstreamCalls.clear();
    upstreamCalls.set(userId, { windowStart: now, count: 1 });
    return true;
  }
  if (entry.count >= MAX_UPSTREAM_PER_USER_PER_HOUR) return false;
  entry.count += 1;
  return true;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("EXERCISE_GIF_API_KEY");
  // No key configured means the feature is off, not broken. `enabled: false`
  // lets the client stop asking for the rest of the page's life instead of
  // paying a round trip per exercise for the same answer.
  if (!apiKey) return json({ gifUrl: null, enabled: false });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Authentication required." }, 401);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
  if (!user) return json({ error: "Authentication required." }, 401);

  let name: unknown;
  try {
    ({ name } = await req.json());
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }
  if (typeof name !== "string" || !name.trim() || name.length > MAX_NAME_CHARS) {
    return json({ error: "An exercise name is required." }, 400);
  }
  const key = name.trim().toLowerCase();
  if (cache.has(key)) return json({ gifUrl: cache.get(key) ?? null });
  if (!allowUpstream(user.id)) {
    return json({ error: "Too many exercise lookups. Try again in an hour." }, 429);
  }

  try {
    const res = await fetch(
      `https://${RAPIDAPI_HOST}/exercises/search?name=${encodeURIComponent(name.trim())}`,
      { headers: { "X-RapidAPI-Key": apiKey, "X-RapidAPI-Host": RAPIDAPI_HOST } },
    );
    if (!res.ok) {
      console.error("exercise-gif upstream", res.status);
      // Not cached: a rate limit or outage should not pin a name to "no gif".
      return json({ gifUrl: null });
    }
    const data = await res.json();
    const gifUrl: string | null = typeof data?.data?.[0]?.gifUrl === "string" ? data.data[0].gifUrl : null;
    remember(key, gifUrl);
    return json({ gifUrl });
  } catch (e) {
    console.error("exercise-gif error:", e);
    return json({ gifUrl: null });
  }
});
