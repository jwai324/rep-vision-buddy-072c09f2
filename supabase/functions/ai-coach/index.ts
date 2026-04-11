import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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
];

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

    const { messages, context, action_results } = await req.json();

    // Build context message
    let contextContent = "";
    if (context) {
      contextContent = `\n\nCURRENT APP CONTEXT:\n${JSON.stringify(context, null, 0)}`;
    }

    // If we have action results, add them
    const allMessages = [...(messages || [])];

    // Handle tool call results from the client
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
      }),
    });

    if (!response.ok) {
      const status = response.status;
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
      const text = await response.text();
      console.error("AI gateway error:", status, text);
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
