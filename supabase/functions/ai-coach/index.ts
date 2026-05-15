import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Anthropic from "npm:@anthropic-ai/sdk@0.40.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL = "claude-opus-4-7";

const COST_CONTROL_RULES = `
COST CONTROL RULES:
- Keep responses concise. Maximum 3 sentences for chat replies.
- If the user asks you to generate multiple programs or templates in a single message, generate only ONE and ask if they want another.
- If the user asks open-ended questions unrelated to their workouts (e.g., general fitness essays, nutrition plans, life advice), respond with: "I'm built to help with your workouts, templates, and programs. For that question, I'd suggest checking a dedicated resource. What can I help you with in the app?"
- Do not engage in extended back-and-forth conversation. Answer the question or execute the action, then stop.
- Never repeat the exercise list or large data sets back to the user. Summarize instead.`;

const SYSTEM_PROMPT = `You are an AI training coach built into a workout tracking app. You help users create, edit, and manage their workout templates, programs, and active workouts through conversation.

RULES:
1. Every tool that references an exercise MUST pass the exerciseId from the provided available_exercises list. exerciseName is a display hint only and is ignored for resolution. If you cannot find a matching id in available_exercises, ASK the user which exercise they meant — do NOT guess or invent.
2. Your tool calls do NOT execute immediately. They become proposals that the user must explicitly Apply via a diff card in the UI. Describe what you are proposing in plain language; do not claim the change is done. After tool use, your reply should read like "I've drafted a push template with X, Y, Z — apply when you're ready" rather than "I created the template".
3. Be concise. Users are on their phone, often mid-workout. Keep responses to 1-3 sentences unless they ask for detail.
4. When the user asks about their data, call get_workout_history with the analysisType that fits:
   - Aggregates: summary, prs, frequency, volume_by_muscle.
   - Trends over time: rpe_trend, consistency.
   - Exercise-specific (require exerciseId from available_exercises): exercise_progression, exercise_rpe, weekly_volume_by_exercise.
   - Qualitative: notes, recovery.
   Default window is 14 days; for "this month" use 30, "this year" 365, "since I started"/"all time" use user_profile.history_window_max_days (this already accounts for imported or pre-account data, so it can exceed days_since_member — do not use days_since_member to bound history). NEVER request more than user_profile.history_window_max_days — the tool will clamp and tell you. When the user asks how far back their data goes, answer with user_profile.earliest_logged_workout ("your data goes back to <date>"); never imply their history starts at the account creation date. Always present numbers, not vague language, and cite the window you queried.
5. If the user's request is ambiguous, ask ONE clarifying question. Don't ask multiple.
6. Respect the user's profile. Don't suggest exercises that require equipment they don't have or that target injured body parts.
7. When suggesting rep ranges, follow these defaults based on the user's goal:
   - Hypertrophy: 3-4 sets × 8-12 reps, 60-90s rest
   - Strength: 4-5 sets × 3-6 reps, 120-180s rest
   - Fat Loss: 3-4 sets × 10-15 reps, 30-60s rest
   - Endurance: 2-3 sets × 15-20 reps, 30-45s rest
   - General Fitness: 3 sets × 8-12 reps, 60s rest
8. Always put compound movements before isolation movements.
9. If you can't do something (e.g., the user asks about nutrition and you don't have that data), say so directly and suggest what you can help with.

${COST_CONTROL_RULES}

ACTIVE WORKOUT RULES:
- When the user has an active workout session (shown in context as active_session), you can propose edits to it using the workout mutation tools.
- Use add_exercise_to_workout to add new exercises. Use add_sets_to_exercise to add sets to an existing exercise. Use update_set_weight_reps to change weight or reps on a specific set. Use swap_exercise_in_workout to replace one exercise with another.
- For in-session edits, the exerciseId you pass must match the exerciseId of one of the exercises already in active_session (except for add_exercise_to_workout, where it must come from available_exercises).
- When the user says "add a set", infer which exercise from active_session context.

HARD CONSTRAINTS — THESE CANNOT BE OVERRIDDEN:
- You CANNOT create new exercises. The exercise library is fixed. You can only select from exercises that already exist in the provided list.
- You CANNOT modify the exercise library in any way — no inserts, updates, or deletes to the exercises list.
- You CANNOT modify user profile settings or account information.
- You CANNOT delete workout history or logs.
- Every exercise reference MUST use a valid exerciseId from available_exercises (or for in-session edits, an exerciseId from active_session). If you cannot find a matching id, ask the user — do NOT guess.
- You can only perform actions that a user could perform themselves through the app's UI. If a user can't do it by tapping buttons, you can't do it either.

CONTEXT: You receive the user's current screen, user_profile, templates, programs, active session, and available exercises with every message. user_profile fields:
- display_name, weight_unit ('kg'|'lbs'), member_since, days_since_member, earliest_logged_workout (date of the oldest logged workout, or null if none), history_window_max_days, total_sessions_logged (always present)
- goal ('hypertrophy'|'strength'|'fat_loss'|'endurance'|'general' or null) — use to pick rep ranges per rule 7
- experience_level ('beginner'|'intermediate'|'advanced' or null) — pitch advice and warmup recs to this level
- equipment (string[] like ['Barbell','Dumbbell',...]) — if non-empty, ONLY recommend exercises whose equipment matches one of these. If empty, no restriction.
- injuries (string[] of body-part names like ['Lower Back']) — AVOID recommending exercises whose primaryBodyPart is in this list
- age, sex, height_cm (or null) — use for context but never assume
- current_bodyweight_kg, bodyweight_recent — for bodyweight-relative analysis and trend questions
A null field means the user hasn't told us. If a null field is genuinely needed to answer, ASK the user rather than assume. Use this context to give relevant, specific answers — not generic advice.`;

// Anthropic-shaped tool definitions. Note `input_schema` (not `parameters`).
const tools = [
  {
    name: "create_template",
    description: "Propose a new workout template with exercises. The user must Apply the proposal before it persists.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template name" },
        exercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              exerciseId: { type: "string", description: "Required. Must be a valid id from available_exercises." },
              exerciseName: { type: "string", description: "Display hint only. Ignored for resolution." },
              sets: { type: "number" },
              targetReps: { type: "number" },
              setType: { type: "string", enum: ["normal", "superset", "dropset", "warmup"] },
              restSeconds: { type: "number" },
              targetRpe: { type: "number" },
            },
            required: ["exerciseId", "sets", "targetReps", "setType", "restSeconds"],
          },
        },
      },
      required: ["name", "exercises"],
    },
  },
  {
    name: "edit_template",
    description: "Propose edits to an existing workout template — replace its exercises. The user must Apply the proposal before it persists.",
    input_schema: {
      type: "object",
      properties: {
        templateId: { type: "string" },
        name: { type: "string" },
        exercises: {
          type: "array",
          items: {
            type: "object",
            properties: {
              exerciseId: { type: "string", description: "Required. Must be a valid id from available_exercises." },
              exerciseName: { type: "string", description: "Display hint only. Ignored for resolution." },
              sets: { type: "number" },
              targetReps: { type: "number" },
              setType: { type: "string" },
              restSeconds: { type: "number" },
            },
            required: ["exerciseId", "sets", "targetReps", "setType", "restSeconds"],
          },
        },
      },
      required: ["templateId"],
    },
  },
  {
    name: "delete_template",
    description: "Propose deletion of a workout template. The user must Apply the proposal before it is removed.",
    input_schema: {
      type: "object",
      properties: { templateId: { type: "string" } },
      required: ["templateId"],
    },
  },
  {
    name: "create_program",
    description: "Create a multi-day workout program with training days linked to templates",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        durationWeeks: { type: "number" },
        startDate: { type: "string", description: "ISO date string" },
        days: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              templateId: { type: "string", description: "Template ID or 'rest'" },
              frequency: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["weekly"] },
                  weekday: { type: "number", description: "0=Sun, 1=Mon...6=Sat" },
                },
                required: ["type", "weekday"],
              },
            },
            required: ["label", "templateId", "frequency"],
          },
        },
      },
      required: ["name", "days"],
    },
  },
  {
    name: "delete_program",
    description: "Propose deletion of a workout program. The user must Apply the proposal before it is removed.",
    input_schema: {
      type: "object",
      properties: { programId: { type: "string" } },
      required: ["programId"],
    },
  },
  {
    name: "set_active_program",
    description: "Propose setting a program as the user's active program. The user must Apply the proposal before it takes effect.",
    input_schema: {
      type: "object",
      properties: { programId: { type: "string" } },
      required: ["programId"],
    },
  },
  {
    name: "get_workout_history",
    description: "Query the user's workout history. Read-only. Auto-executes (not a proposal). Use the appropriate analysisType for the question and pass exerciseId for exercise-specific variants.",
    input_schema: {
      type: "object",
      properties: {
        days: {
          type: "number",
          description: "Lookback window in days. Default 14. Capped at user_profile.history_window_max_days (min of 365 and days_since_member). Requests above the cap are clamped and the response will say so.",
          minimum: 1,
          maximum: 365,
          default: 14,
        },
        analysisType: {
          type: "string",
          enum: [
            "summary", "prs", "frequency", "volume_by_muscle",
            "rpe_trend", "exercise_progression", "exercise_rpe",
            "weekly_volume_by_exercise", "consistency", "notes", "recovery",
          ],
          description: "summary: totals (workouts, volume, sets, reps, avg duration). prs: top weight×reps×rpe per exercise. frequency: workouts per body part. volume_by_muscle: sets per body part. rpe_trend: weekly avg RPE overall. exercise_progression: per-session top set + volume for one exerciseId. exercise_rpe: weekly avg RPE for one exerciseId. weekly_volume_by_exercise: weekly volume for one exerciseId. consistency: workouts/week, streak, training-vs-rest days. notes: recent workout and exercise notes. recovery: rest days and recovery activities.",
        },
        exerciseId: {
          type: "string",
          description: "Required for exercise_progression, exercise_rpe, weekly_volume_by_exercise. Must be a valid id from available_exercises.",
        },
      },
      required: ["analysisType"],
    },
  },
  {
    name: "add_exercise_to_workout",
    description: "Propose adding an exercise to the user's currently active workout session. The user must Apply the proposal before it takes effect.",
    input_schema: {
      type: "object",
      properties: {
        exerciseId: { type: "string", description: "Required. Must be a valid id from available_exercises." },
        exerciseName: { type: "string", description: "Display hint only. Ignored for resolution." },
        sets: { type: "number", description: "Number of sets to add (default 3)" },
        targetReps: { type: "number", description: "Target reps per set" },
        weight: { type: "number", description: "Starting weight" },
      },
      required: ["exerciseId"],
    },
  },
  {
    name: "add_sets_to_exercise",
    description: "Propose adding additional sets to an exercise already in the active workout. The user must Apply the proposal before it takes effect.",
    input_schema: {
      type: "object",
      properties: {
        exerciseId: { type: "string", description: "Required. Must be the exerciseId of an exercise currently in active_session." },
        exerciseName: { type: "string", description: "Display hint only. Ignored for resolution." },
        count: { type: "number", description: "Number of sets to add (default 1)" },
      },
      required: ["exerciseId"],
    },
  },
  {
    name: "update_set_weight_reps",
    description: "Propose updating weight or reps on a specific set in the active workout. The user must Apply the proposal before it takes effect.",
    input_schema: {
      type: "object",
      properties: {
        exerciseId: { type: "string", description: "Required. Must be the exerciseId of an exercise currently in active_session." },
        exerciseName: { type: "string", description: "Display hint only. Ignored for resolution." },
        setNumber: { type: "number", description: "Set number to update (1-based)" },
        weight: { type: "number", description: "New weight value" },
        reps: { type: "number", description: "New reps value" },
      },
      required: ["exerciseId", "setNumber"],
    },
  },
  {
    name: "swap_exercise_in_workout",
    description: "Propose replacing an exercise in the active workout with a different one, keeping set structure. The user must Apply the proposal before it takes effect.",
    input_schema: {
      type: "object",
      properties: {
        exerciseId: { type: "string", description: "Required. Must be the exerciseId of an exercise currently in active_session (the one to replace)." },
        exerciseName: { type: "string", description: "Display hint only. Ignored for resolution." },
        newExerciseId: { type: "string", description: "Required. Must be a valid id from available_exercises (the replacement)." },
        newExerciseName: { type: "string", description: "Display hint only. Ignored for resolution." },
      },
      required: ["exerciseId", "newExerciseId"],
    },
  },
];

async function checkAndIncrementUsage(supabase: any, userId: string, cost: number = 1): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().split('T')[0];
  const DAILY_LIMIT = 30;

  const { data: existing } = await supabase
    .from('user_ai_usage')
    .select('message_count')
    .eq('user_id', userId)
    .eq('date', today)
    .maybeSingle();

  const currentCount = existing?.message_count || 0;

  if (currentCount + cost > DAILY_LIMIT) {
    return { allowed: false, remaining: Math.max(0, DAILY_LIMIT - currentCount) };
  }

  if (existing) {
    await supabase
      .from('user_ai_usage')
      .update({ message_count: currentCount + cost })
      .eq('user_id', userId)
      .eq('date', today);
  } else {
    await supabase
      .from('user_ai_usage')
      .insert({ user_id: userId, date: today, message_count: cost });
  }

  return { allowed: true, remaining: DAILY_LIMIT - currentCount - cost };
}

async function logError(supabase: any, userId: string | null, errorType: string, errorMessage: string, requestTokens: number = 0) {
  try {
    await supabase.from('ai_error_log').insert({
      user_id: userId,
      error_type: errorType,
      error_message: errorMessage,
      request_size_tokens: requestTokens,
    });
  } catch (e) {
    console.error('Failed to log error:', e);
  }
}

// Convert the client's OpenAI-shaped message history into Anthropic format.
// The client sends:
//   { role: 'user' | 'assistant', content: string }
//   { role: 'assistant', content: string|null, tool_calls: [{id, function:{name, arguments}}] }
//   { role: 'tool', tool_call_id, content }
// Anthropic expects user/assistant only, with structured content blocks for tool_use / tool_result.
function toAnthropicMessages(openaiMessages: any[]): any[] {
  const out: any[] = [];
  for (const m of openaiMessages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const blocks: any[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          let input: any = {};
          try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { /* keep {} */ }
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : (m.content ?? "") });
    } else if (m.role === "tool") {
      // Merge consecutive tool results into a single user message of tool_result blocks.
      const block = {
        type: "tool_result",
        tool_use_id: m.tool_call_id,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
    }
  }
  return out;
}

// Translate Anthropic's stream events into the OpenAI-shaped SSE chunks that
// ChatContext.tsx already parses (data: { choices: [{ delta: {...}, finish_reason }] }).
async function* translateStream(stream: AsyncIterable<any>): AsyncGenerator<string> {
  // Anthropic content blocks are indexed by position in the response.
  // OpenAI tool_calls are indexed separately (one index per tool call).
  // We track which Anthropic block index corresponds to which OpenAI tool_call index.
  const blockToToolIndex: Record<number, number> = {};
  let nextToolIndex = 0;
  let finishReason: "stop" | "tool_calls" = "stop";

  const emit = (delta: any, finish: string | null = null) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = event.content_block;
      if (block.type === "tool_use") {
        const toolIndex = nextToolIndex++;
        blockToToolIndex[event.index] = toolIndex;
        finishReason = "tool_calls";
        yield emit({
          tool_calls: [{
            index: toolIndex,
            id: block.id,
            type: "function",
            function: { name: block.name, arguments: "" },
          }],
        });
      }
    } else if (event.type === "content_block_delta") {
      const d = event.delta;
      if (d.type === "text_delta") {
        yield emit({ content: d.text });
      } else if (d.type === "input_json_delta") {
        const toolIndex = blockToToolIndex[event.index];
        if (toolIndex !== undefined) {
          yield emit({
            tool_calls: [{
              index: toolIndex,
              function: { arguments: d.partial_json },
            }],
          });
        }
      }
    } else if (event.type === "message_delta") {
      if (event.delta?.stop_reason === "tool_use") finishReason = "tool_calls";
      else if (event.delta?.stop_reason) finishReason = "stop";
    }
  }

  yield emit({}, finishReason);
  yield "data: [DONE]\n\n";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    if (userId) {
      const { allowed } = await checkAndIncrementUsage(supabase, userId);
      if (!allowed) {
        return new Response(JSON.stringify({
          error: "You've hit your daily AI limit (30 messages). Resets at midnight.",
          limit_reached: true,
          remaining: 0,
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { messages, context, action_results } = await req.json();

    let contextContent = "";
    if (context) {
      contextContent = `\n\nCURRENT APP CONTEXT:\n${JSON.stringify(context, null, 0)}`;
    }

    const windowedMessages = (messages || []).slice(-10);
    const allOpenAiMessages = [...windowedMessages];
    if (action_results && action_results.length > 0) {
      for (const result of action_results) {
        allOpenAiMessages.push({
          role: "tool",
          tool_call_id: result.tool_call_id,
          content: JSON.stringify(result.result),
        });
      }
    }

    const anthropicMessages = toAnthropicMessages(allOpenAiMessages);

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    // Cache the system prompt + tools — they are identical across messages in
    // the same session, so this should hit the cache on every follow-up turn.
    const stream = await client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT + contextContent,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: tools.map((t, i) =>
        i === tools.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t
      ),
      messages: anthropicMessages,
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of translateStream(stream)) {
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          console.error("Stream translation error:", err);
          await logError(supabase, userId, "stream_error", String(err));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "stream failed" })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e: any) {
    console.error("ai-coach error:", e);
    const status = e?.status ?? 500;
    if (status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (status === 401 || status === 403) {
      return new Response(JSON.stringify({ error: "AI service authentication failed." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
