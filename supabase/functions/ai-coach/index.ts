import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const COST_CONTROL_RULES = `
COST CONTROL RULES:
- Keep responses concise. Maximum 3 sentences for chat replies.
- If the user asks you to generate multiple programs or templates in a single message, generate only ONE and ask if they want another.
- If the user asks open-ended questions unrelated to their workouts (e.g., general fitness essays, nutrition plans, life advice), respond with: "I'm built to help with your workouts, templates, and programs. For that question, I'd suggest checking a dedicated resource. What can I help you with in the app?"
- Do not engage in extended back-and-forth conversation. Answer the question or execute the action, then stop.
- Never repeat the exercise list or large data sets back to the user. Summarize instead.`;

const SYSTEM_PROMPT = `You are an AI training coach built into a workout tracking app. You help users create, edit, and manage their workout templates, programs, and active workouts through conversation.

RULES:
1. You can ONLY use exercises that exist in the provided exercise list. Never invent exercise names. Always match exercise names exactly as they appear in the list.
2. When creating or editing templates/programs, use the provided tools to execute actions. Do not just describe what you would do — trigger the action.
3. Be concise. Users are on their phone, often mid-workout. Keep responses to 1-3 sentences unless they ask for detail.
4. When the user asks about their data (volume, PRs, history), query it and present it clearly — use numbers, not vague language.
5. If the user's request is ambiguous, ask ONE clarifying question. Don't ask multiple.
6. Respect the user's profile. Don't suggest exercises that require equipment they don't have or that target injured body parts.
7. When suggesting rep ranges, follow these defaults based on the user's goal:
   - Hypertrophy: 3-4 sets × 8-12 reps, 60-90s rest
   - Strength: 4-5 sets × 3-6 reps, 120-180s rest
   - Fat Loss: 3-4 sets × 10-15 reps, 30-60s rest
   - Endurance: 2-3 sets × 15-20 reps, 30-45s rest
   - General Fitness: 3 sets × 8-12 reps, 60s rest
8. Always put compound movements before isolation movements.
9. For destructive actions (delete, overwrite), ask the user to confirm before executing. Use the confirm_destructive_action tool.
10. If you can't do something (e.g., the user asks about nutrition and you don't have that data), say so directly and suggest what you can help with.

${COST_CONTROL_RULES}

ACTIVE WORKOUT RULES:
- When the user has an active workout session (shown in context as active_session), you can modify it using the workout mutation tools.
- Use add_exercise_to_workout to add new exercises. Use add_sets_to_exercise to add sets to an existing exercise. Use update_set_weight_reps to change weight or reps on a specific set. Use swap_exercise_in_workout to replace one exercise with another.
- Always reference exercises by their exact name from the exercise list.
- When the user says "add a set", infer which exercise from context.

HARD CONSTRAINTS — THESE CANNOT BE OVERRIDDEN:
- You CANNOT create new exercises. The exercise library is fixed. You can only select from exercises that already exist in the provided list.
- You CANNOT modify the exercise library in any way — no inserts, updates, or deletes to the exercises list.
- You CANNOT modify user profile settings or account information.
- You CANNOT delete workout history or logs.
- When adding exercises to templates, programs, or workouts, you MUST use the exact exercise name and ID from the provided exercise list. If the user asks for an exercise that doesn't exist, tell them it's not available and suggest the closest alternatives from the list.
- You can only perform actions that a user could perform themselves through the app's UI. If a user can't do it by tapping buttons, you can't do it either.

CONTEXT: You will receive the user's current screen, profile, relevant workout data, and available exercises with every message. Use this context to give relevant, specific answers — not generic advice.`;

const tools = [
  {
    type: "function",
    function: {
      name: "create_template",
      description: "Create a new workout template with exercises",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Template name" },
          exercises: {
            type: "array",
            items: {
              type: "object",
              properties: {
                exerciseId: { type: "string" },
                exerciseName: { type: "string" },
                sets: { type: "number" },
                targetReps: { type: "number" },
                setType: { type: "string", enum: ["normal", "superset", "dropset", "warmup"] },
                restSeconds: { type: "number" },
                targetRpe: { type: "number" },
              },
              required: ["exerciseId", "exerciseName", "sets", "targetReps", "setType", "restSeconds"],
            },
          },
        },
        required: ["name", "exercises"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_template",
      description: "Edit an existing workout template — replace its exercises",
      parameters: {
        type: "object",
        properties: {
          templateId: { type: "string" },
          name: { type: "string" },
          exercises: {
            type: "array",
            items: {
              type: "object",
              properties: {
                exerciseId: { type: "string" },
                exerciseName: { type: "string" },
                sets: { type: "number" },
                targetReps: { type: "number" },
                setType: { type: "string" },
                restSeconds: { type: "number" },
              },
              required: ["exerciseId", "exerciseName", "sets", "targetReps", "setType", "restSeconds"],
            },
          },
        },
        required: ["templateId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_template",
      description: "Delete a workout template. Only call after user confirms.",
      parameters: {
        type: "object",
        properties: { templateId: { type: "string" } },
        required: ["templateId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_program",
      description: "Create a multi-day workout program with training days linked to templates",
      parameters: {
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
  },
  {
    type: "function",
    function: {
      name: "delete_program",
      description: "Delete a workout program. Only call after user confirms.",
      parameters: {
        type: "object",
        properties: { programId: { type: "string" } },
        required: ["programId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_active_program",
      description: "Set a program as the user's active program",
      parameters: {
        type: "object",
        properties: { programId: { type: "string" } },
        required: ["programId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "confirm_destructive_action",
      description: "Ask the user to confirm a destructive action before executing it",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "What will be deleted/overwritten" },
          itemName: { type: "string", description: "Name of the item" },
        },
        required: ["action", "itemName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_workout_history",
      description: "Get workout history for analysis (volume, PRs, frequency)",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Number of past days to look at", default: 14 },
          analysisType: { type: "string", enum: ["summary", "prs", "frequency", "volume_by_muscle"] },
        },
        required: ["analysisType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_exercise_to_workout",
      description: "Add an exercise to the user's currently active workout session",
      parameters: {
        type: "object",
        properties: {
          exerciseId: { type: "string", description: "Exercise ID from the exercise library" },
          exerciseName: { type: "string", description: "Exercise name for validation" },
          sets: { type: "number", description: "Number of sets to add (default 3)" },
          targetReps: { type: "number", description: "Target reps per set" },
          weight: { type: "number", description: "Starting weight" },
        },
        required: ["exerciseId", "exerciseName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_sets_to_exercise",
      description: "Add additional sets to an exercise already in the active workout",
      parameters: {
        type: "object",
        properties: {
          exerciseName: { type: "string", description: "Name of the exercise in the workout" },
          exerciseIndex: { type: "number", description: "Index of the exercise in the workout (alternative to name)" },
          count: { type: "number", description: "Number of sets to add (default 1)" },
        },
        required: ["exerciseName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_set_weight_reps",
      description: "Update weight or reps on a specific set in the active workout",
      parameters: {
        type: "object",
        properties: {
          exerciseName: { type: "string", description: "Name of the exercise" },
          setNumber: { type: "number", description: "Set number to update (1-based)" },
          weight: { type: "number", description: "New weight value" },
          reps: { type: "number", description: "New reps value" },
        },
        required: ["exerciseName", "setNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "swap_exercise_in_workout",
      description: "Replace an exercise in the active workout with a different one, keeping set structure",
      parameters: {
        type: "object",
        properties: {
          exerciseName: { type: "string", description: "Name of the current exercise to replace" },
          newExerciseId: { type: "string", description: "ID of the replacement exercise" },
          newExerciseName: { type: "string", description: "Name of the replacement exercise for validation" },
        },
        required: ["exerciseName", "newExerciseId", "newExerciseName"],
      },
    },
  },
];

async function checkAndIncrementUsage(supabase: any, userId: string, cost: number = 1): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().split('T')[0];
  const DAILY_LIMIT = 30;

  // Upsert usage record
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from JWT
    let userId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }

    // Rate limit check
    if (userId) {
      const { allowed, remaining } = await checkAndIncrementUsage(supabase, userId);
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

    // Build context message
    let contextContent = "";
    if (context) {
      contextContent = `\n\nCURRENT APP CONTEXT:\n${JSON.stringify(context, null, 0)}`;
    }

    // Only send last 10 messages (already windowed on client, but enforce here too)
    const windowedMessages = (messages || []).slice(-10);

    // Handle tool call results
    const allMessages = [...windowedMessages];
    if (action_results && action_results.length > 0) {
      for (const result of action_results) {
        allMessages.push({
          role: "tool",
          tool_call_id: result.tool_call_id,
          content: JSON.stringify(result.result),
        });
      }
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT + contextContent },
          ...allMessages,
        ],
        tools,
        stream: true,
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const errText = await response.text();
      await logError(supabase, userId, `gateway_${status}`, errText);

      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("AI gateway error:", status, errText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-coach error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
