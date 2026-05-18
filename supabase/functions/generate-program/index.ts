import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Anthropic from "npm:@anthropic-ai/sdk@0.40.0";
import { costMicros } from "../_shared/pricing.ts";
import { consume, gate, getOrInitBalance, applyLazyMonthlyReset, recordUsageAggregate } from "../_shared/balance.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You are a certified strength and conditioning coach building a workout program.

RULES:
- ONLY select exercises from the provided exercise list. Never invent exercises.
- Return the program as valid JSON matching the schema below.
- Program structure: a weekly split across the user's available training days.
- Each training day has a name (e.g., "Upper A", "Push", "Legs") and an ordered list of exercises.
- For each exercise, specify: exercise name (must match exactly from the list), sets, reps (or rep range), rest period in seconds, set type (normal, superset, dropset), and order position.
- Compound movements first, isolation movements last within each day.
- Apply these rep ranges based on goal:
  - Hypertrophy: 3-4 sets × 8-12 reps, 60-90s rest
  - Strength: 4-5 sets × 3-6 reps, 120-180s rest
  - Fat Loss: 3-4 sets × 10-15 reps, 30-60s rest, include supersets
  - Endurance: 2-3 sets × 15-20 reps, 30-45s rest
  - General Fitness: 3 sets × 8-12 reps, 60s rest
- Balance push/pull volume. Include at minimum: 1 hinge, 1 squat pattern, 1 horizontal push, 1 horizontal pull, 1 vertical push, 1 vertical pull per week.
- Respect the session duration constraint — keep total working sets per session reasonable (beginner: 12-16 sets, intermediate: 16-22 sets, advanced: 20-28 sets).
- If user has injuries, avoid those body parts entirely and do not substitute — just reduce volume for that day.

COST CONTROL RULES:
- Generate only ONE program per request. Do not generate variations.
- Keep the response as compact JSON — no extra whitespace or commentary.

HARD CONSTRAINTS:
- You CANNOT invent or create new exercises. ONLY use exercise names that EXACTLY match the provided exercise list.
- If an exercise the user wants is not in the list, pick the closest available alternative and use that instead.
- Every exercise_name in your output MUST appear verbatim in the provided exercise list.

IMPORTANT: Return ONLY valid JSON, no markdown, no code fences.

JSON SCHEMA:
{
  "program_name": "string",
  "goal": "string",
  "days_per_week": number,
  "weeks": <must match the user's requested program duration>,
  "training_days": [
    {
      "day_number": 1,
      "day_name": "string (e.g., 'Push A')",
      "focus": "string (e.g., 'Chest, Shoulders, Triceps')",
      "exercises": [
        {
          "exercise_name": "string (exact match from exercise list)",
          "sets": number,
          "reps": "string (e.g., '8-12' or '5')",
          "rest_seconds": number,
          "set_type": "normal | superset | dropset",
          "order": number,
          "superset_group": null
        }
      ]
    }
  ]
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    const { userInputs, exercises, premium } = await req.json();

    // Pre-call balance gate. Real cost is deducted after the call. Premium tier
    // bypasses the gate (default while the app is in testing).
    if (userId && premium !== true) {
      const balance = applyLazyMonthlyReset(await getOrInitBalance(supabase, userId));
      if (!gate(balance).allowed) {
        return new Response(JSON.stringify({
          error: "You're out of AI credits.",
          balance_exhausted: true,
        }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const customNotes = userInputs.custom_notes ? `\n- Additional notes from user: ${userInputs.custom_notes}` : '';
    const programWeeks = parseInt(String(userInputs.programDuration)) || 4;

    const userPrompt = `Build a workout program with these specifications:
- Goal: ${userInputs.goal}
- Experience: ${userInputs.experience}
- Days per week: ${userInputs.daysPerWeek}
- Session duration: ${userInputs.sessionDuration}
- Program duration: ${programWeeks} weeks (MUST set "weeks" to exactly ${programWeeks})
- Available equipment: ${userInputs.equipment.join(', ')}
- Injuries/constraints: ${userInputs.injuries || 'None'}
- Split preference: ${userInputs.splitPreference || 'No preference'}${customNotes}

Available exercises (use ONLY from this list, names must match exactly):
${exercises.map((e: any) => `- ${e.name} (${e.primaryBodyPart}, ${e.equipment}, ${e.exerciseType}, ${e.movementPattern})`).join('\n')}`;

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    let message;
    try {
      message = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userPrompt }],
      });
    } catch (err: any) {
      const status = err?.status ?? 500;
      if (userId) {
        await supabase.from('ai_error_log').insert({
          user_id: userId,
          error_type: `anthropic_${status}`,
          error_message: String(err?.message ?? err),
        });
      }
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("Anthropic error:", status, err);
      return new Response(JSON.stringify({ error: "AI generation failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Meter real token usage. The call succeeded and Anthropic billed us, so we
    // consume even if the JSON later fails to parse (deters abuse via repeated
    // failing prompts). Never let a metering failure break the response.
    if (userId) {
      try {
        const cost = costMicros(message.usage);
        await consume(supabase, userId, cost, "generate_program", `generate-program:${userId}:${Date.now()}`);
        await recordUsageAggregate(supabase, userId, message.usage, cost);
      } catch (e) {
        console.error("generate-program metering failed:", e);
      }
    }

    if (message.stop_reason === "max_tokens") {
      console.error("AI response truncated (stop_reason=max_tokens)");
      return new Response(JSON.stringify({ error: "AI response was too long and got cut off. Try reducing days or session duration." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const textBlock = message.content.find((b: any) => b.type === "text");
    let content = textBlock && "text" in textBlock ? textBlock.text : "";
    content = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

    try {
      const program = JSON.parse(content);
      return new Response(JSON.stringify({ program }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch {
      console.error("Failed to parse AI response as JSON:", content.substring(0, 500));
      if (userId) {
        await supabase.from('ai_error_log').insert({
          user_id: userId,
          error_type: 'json_parse_error',
          error_message: content.substring(0, 500),
        });
      }
      return new Response(JSON.stringify({ error: "AI returned invalid format. Please try again.", raw: content.substring(0, 1000) }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("generate-program error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
