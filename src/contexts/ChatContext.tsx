import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { supabase } from '@/integrations/supabase/client';
import { getSessionController, isSessionActive } from '@/hooks/useSessionController';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  isLoading?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
  result?: any;
  status: 'pending' | 'executing' | 'done' | 'error' | 'confirm';
}

interface ScreenContext {
  screen: string;
  data?: any;
}

interface ChatContextType {
  messages: ChatMessage[];
  isOpen: boolean;
  isLoading: boolean;
  currentScreen: string;
  setOpen: (open: boolean) => void;
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
  registerScreen: (ctx: ScreenContext) => void;
  confirmAction: (toolCallId: string, confirmed: boolean) => void;
  quickChips: string[];
  dailyUsage: { count: number; limit: number; limitReached: boolean };
  consecutiveErrors: number;
  cooldownActive: boolean;
}

const ChatContext = createContext<ChatContextType>({
  messages: [],
  isOpen: false,
  isLoading: false,
  currentScreen: 'dashboard',
  setOpen: () => {},
  sendMessage: async () => {},
  clearChat: () => {},
  registerScreen: () => {},
  confirmAction: () => {},
  quickChips: [],
  dailyUsage: { count: 0, limit: 30, limitReached: false },
  consecutiveErrors: 0,
  cooldownActive: false,
});

export const useChatContext = () => useContext(ChatContext);

// Lean exercise list for context (no secondary muscles)
const exerciseListLean = EXERCISE_DATABASE.map(e => ({
  exercise: e.name,
  id: e.id,
  primary_body_part: e.primaryBodyPart,
  equipment: e.equipment,
  exercise_type: e.exerciseType,
  movement_pattern: e.movementPattern,
  difficulty: e.difficulty,
}));

// Build lookup maps for fast validation
const EXERCISE_BY_ID = new Map(EXERCISE_DATABASE.map(e => [e.id, e]));
const EXERCISE_BY_NAME_LOWER = new Map(EXERCISE_DATABASE.map(e => [e.name.toLowerCase(), e]));

// Allowed AI actions — anything not here is blocked
const AI_ALLOWED_ACTIONS = new Set([
  'create_template', 'edit_template', 'delete_template',
  'create_program', 'delete_program', 'set_active_program',
  'confirm_destructive_action', 'get_workout_history',
  'add_exercise_to_workout', 'add_sets_to_exercise',
  'update_set_weight_reps', 'swap_exercise_in_workout',
]);

// Actions that require exercise validation before execution
const ACTIONS_REQUIRING_EXERCISE_VALIDATION = new Set([
  'create_template', 'edit_template', 'create_program',
  'add_exercise_to_workout', 'swap_exercise_in_workout',
]);

function validateExerciseReference(exerciseId: string, exerciseName?: string): { valid: boolean; resolvedId?: string; error?: string; suggestions?: string[] } {
  // Check by ID first
  if (EXERCISE_BY_ID.has(exerciseId)) return { valid: true, resolvedId: exerciseId };

  // Check by name (exact, case-insensitive)
  if (exerciseName) {
    const byName = EXERCISE_BY_NAME_LOWER.get(exerciseName.toLowerCase());
    if (byName) return { valid: true, resolvedId: byName.id };
  }

  // Fuzzy search by partial name match
  const searchTerm = (exerciseName || exerciseId).toLowerCase();
  const fuzzyMatches = EXERCISE_DATABASE
    .filter(e => e.name.toLowerCase().includes(searchTerm) || searchTerm.includes(e.name.toLowerCase()))
    .slice(0, 5);

  if (fuzzyMatches.length > 0) {
    return {
      valid: false,
      suggestions: fuzzyMatches.map(e => e.name),
      error: `"${exerciseName || exerciseId}" is not in the exercise library. Did you mean: ${fuzzyMatches.map(e => e.name).join(', ')}?`,
    };
  }

  return {
    valid: false,
    suggestions: [],
    error: `"${exerciseName || exerciseId}" is not in the exercise library. Only existing exercises can be used.`,
  };
}

function validateAllExercises(exercises: any[]): { valid: boolean; validated: any[]; errors: string[] } {
  const errors: string[] = [];
  const validated = exercises.map(e => {
    const result = validateExerciseReference(e.exerciseId, e.exerciseName);
    if (!result.valid) {
      errors.push(result.error!);
      return null;
    }
    return { ...e, exerciseId: result.resolvedId };
  }).filter(Boolean);

  return { valid: errors.length === 0, validated: validated as any[], errors };
}

const SCREEN_CHIPS: Record<string, string[]> = {
  programs: ["Build me a program", "Edit current program", "What should I train today?"],
  templates: ["Create a template", "Duplicate this template", "Add an exercise"],
  active_workout: ["Swap this exercise", "Add a set", "How's my volume this week?"],
  activity: ["Summarize my week", "Compare this week to last", "What are my PRs?"],
  dashboard: ["Build me a program", "Create a template", "What should I train today?"],
  analytics: ["Summarize my week", "Compare this week to last", "What are my PRs?"],
};

const DEFAULT_CHIPS = ["Build me a program", "Create a template", "What should I train today?"];

// Actions that need the exercise list
const EXERCISE_LIST_ACTIONS = ['create_template', 'edit_template', 'create_program', 'edit_program'];
// Keywords that suggest exercise list is needed
const EXERCISE_KEYWORDS = ['template', 'program', 'exercise', 'create', 'build', 'swap', 'add exercise', 'workout plan'];

function needsExerciseList(messageText: string, screen: string): boolean {
  const lower = messageText.toLowerCase();
  if (['templates', 'programs'].includes(screen)) return true;
  return EXERCISE_KEYWORDS.some(kw => lower.includes(kw));
}

const DAILY_LIMIT = 30;
const COOLDOWN_MS = 2000;
const MESSAGE_WINDOW = 10;
const DISABLE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export const ChatProvider: React.FC<{
  children: React.ReactNode;
  storage: any;
}> = ({ children, storage }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const screenRef = useRef<ScreenContext>({ screen: 'dashboard' });
  const [currentScreen, setCurrentScreen] = useState('dashboard');
  const [dailyUsage, setDailyUsage] = useState({ count: 0, limit: DAILY_LIMIT, limitReached: false });
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [disabledUntil, setDisabledUntil] = useState(0);
  const sendDisabledUntil = useRef(0);

  const registerScreen = useCallback((ctx: ScreenContext) => {
    screenRef.current = ctx;
    setCurrentScreen(ctx.screen);
  }, []);

  const quickChips = SCREEN_CHIPS[currentScreen] || DEFAULT_CHIPS;

  // Fetch daily usage on mount
  useEffect(() => {
    const fetchUsage = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('user_ai_usage')
        .select('message_count')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle();
      const count = data?.message_count || 0;
      setDailyUsage({ count, limit: DAILY_LIMIT, limitReached: count >= DAILY_LIMIT });
    };
    fetchUsage();
  }, []);

  const buildContext = useCallback((messageText: string) => {
    const ctx: any = {
      current_screen: screenRef.current.screen,
      current_data: screenRef.current.data || {},
    };

    // Only include exercise list when needed
    if (needsExerciseList(messageText, screenRef.current.screen)) {
      ctx.available_exercises = exerciseListLean;
    }

    if (storage.templates?.length > 0) {
      ctx.user_templates = storage.templates.map((t: any) => ({ id: t.id, name: t.name, exerciseCount: t.exercises?.length }));
    }
    if (storage.programs?.length > 0) {
      ctx.user_programs = storage.programs.map((p: any) => ({ id: p.id, name: p.name, days: p.days?.length }));
    }
    if (storage.activeProgramId) {
      ctx.active_program_id = storage.activeProgramId;
    }

    // Include active session state when in a workout
    if (isSessionActive()) {
      const controller = getSessionController();
      if (controller) {
        const blocks = controller.getBlocks();
        ctx.active_session = {
          exercises: blocks.map((b, i) => ({
            index: i,
            exerciseId: b.exerciseId,
            exerciseName: b.exerciseName,
            sets: b.sets.map(s => ({
              setNumber: s.setNumber,
              weight: s.weight,
              reps: s.reps,
              completed: s.completed,
              type: s.type,
            })),
          })),
        };
      }
    }

    return ctx;
  }, [storage]);

  const executeToolCall = useCallback(async (tc: ToolCall): Promise<any> => {
    // Allowlist check — block any action not explicitly permitted
    if (!AI_ALLOWED_ACTIONS.has(tc.name)) {
      return { error: `Action "${tc.name}" is not allowed. I can only perform actions available through the app's UI.` };
    }

    const args = tc.arguments;

    // Exercise validation for actions that reference exercises
    if (ACTIONS_REQUIRING_EXERCISE_VALIDATION.has(tc.name)) {
      // For template/program actions, validate exercises array
      if (args.exercises?.length > 0) {
        const { valid, validated, errors } = validateAllExercises(args.exercises);
        if (!valid) {
          return { success: false, message: errors.join('\n'), validation_errors: errors };
        }
        args.exercises = validated;
      }
      // For workout actions, validate single exercise references
      if (args.exerciseId) {
        const result = validateExerciseReference(args.exerciseId, args.exerciseName);
        if (!result.valid) {
          return { success: false, message: result.error, suggestions: result.suggestions };
        }
        args.exerciseId = result.resolvedId;
      }
      if (args.newExerciseId) {
        const result = validateExerciseReference(args.newExerciseId, args.newExerciseName);
        if (!result.valid) {
          return { success: false, message: result.error, suggestions: result.suggestions };
        }
        args.newExerciseId = result.resolvedId;
      }
    }

    switch (tc.name) {
      case 'create_template': {
        const template = {
          id: crypto.randomUUID(),
          name: args.name,
          exercises: args.exercises.map((e: any) => ({
            exerciseId: e.exerciseId,
            sets: e.sets,
            targetReps: e.targetReps,
            setType: e.setType || 'normal',
            restSeconds: e.restSeconds || 90,
            targetRpe: e.targetRpe,
          })),
        };
        await storage.saveTemplate(template);
        return { success: true, templateId: template.id, message: `Created template "${args.name}" with ${args.exercises.length} exercises.` };
      }
      case 'edit_template': {
        const existing = storage.templates.find((t: any) => t.id === args.templateId);
        if (!existing) return { success: false, message: "Template not found" };
        const updated = { ...existing, name: args.name || existing.name, exercises: args.exercises || existing.exercises };
        await storage.saveTemplate(updated);
        return { success: true, message: `Updated template "${updated.name}".` };
      }
      case 'delete_template': {
        await storage.deleteTemplate(args.templateId);
        return { success: true, message: "Template deleted." };
      }
      case 'create_program': {
        const programId = crypto.randomUUID();
        const program = { id: programId, name: args.name, days: args.days, durationWeeks: args.durationWeeks || 8, startDate: args.startDate || new Date().toISOString().split('T')[0] };
        await storage.saveProgram(program);
        return { success: true, programId, message: `Created program "${args.name}".` };
      }
      case 'delete_program': {
        await storage.deleteProgram(args.programId);
        return { success: true, message: "Program deleted." };
      }
      case 'set_active_program': {
        await storage.setActiveProgram(args.programId);
        return { success: true, message: "Active program updated." };
      }
      case 'confirm_destructive_action':
        return { needs_confirmation: true, action: args.action, itemName: args.itemName };
      
      // Active workout mutation actions
      case 'add_exercise_to_workout': {
        const controller = getSessionController();
        if (!controller) return { success: false, message: "No active workout session. Start a workout first." };
        const ok = controller.addExercise(args.exerciseId, args.sets || 3, args.targetReps, args.weight);
        if (!ok) return { success: false, message: "Exercise is already in the workout." };
        const exName = EXERCISE_DATABASE.find(e => e.id === args.exerciseId)?.name || args.exerciseId;
        return { success: true, message: `Added ${exName} to your workout.` };
      }
      case 'add_sets_to_exercise': {
        const controller = getSessionController();
        if (!controller) return { success: false, message: "No active workout session." };
        const identifier = args.exerciseName || args.exerciseIndex?.toString();
        const ok = controller.addSets(identifier, args.count || 1);
        if (!ok) return { success: false, message: `Couldn't find "${args.exerciseName || args.exerciseIndex}" in the current workout.` };
        return { success: true, message: `Added ${args.count || 1} set(s) to ${args.exerciseName || 'the exercise'}.` };
      }
      case 'update_set_weight_reps': {
        const controller = getSessionController();
        if (!controller) return { success: false, message: "No active workout session." };
        const ok = controller.updateSet(args.exerciseName, args.setNumber, { weight: args.weight, reps: args.reps });
        if (!ok) return { success: false, message: `Couldn't find set ${args.setNumber} of "${args.exerciseName}" in the current workout.` };
        return { success: true, message: `Updated set ${args.setNumber} of ${args.exerciseName}.` };
      }
      case 'swap_exercise_in_workout': {
        const controller = getSessionController();
        if (!controller) return { success: false, message: "No active workout session." };
        const ok = controller.swapExercise(args.exerciseName, args.newExerciseId);
        if (!ok) return { success: false, message: `Couldn't find "${args.exerciseName}" in the current workout.` };
        const newName = EXERCISE_DATABASE.find(e => e.id === args.newExerciseId)?.name || args.newExerciseId;
        return { success: true, message: `Swapped ${args.exerciseName} for ${newName}.` };
      }

      case 'get_workout_history': {
        const days = args.days || 14;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0];
        const recent = storage.history.filter((s: any) => s.date >= cutoffStr && !s.isRestDay);

        if (args.analysisType === 'summary') {
          return {
            period_days: days, total_workouts: recent.length,
            total_volume: recent.reduce((s: number, w: any) => s + w.totalVolume, 0),
            total_sets: recent.reduce((s: number, w: any) => s + w.totalSets, 0),
            total_reps: recent.reduce((s: number, w: any) => s + w.totalReps, 0),
            avg_duration_min: recent.length ? Math.round(recent.reduce((s: number, w: any) => s + w.duration, 0) / recent.length / 60) : 0,
          };
        }
        if (args.analysisType === 'prs') {
          const prs: Record<string, { weight: number; reps: number }> = {};
          for (const session of recent) {
            for (const ex of session.exercises) {
              for (const set of ex.sets) {
                const key = ex.exerciseName || ex.exerciseId;
                if (!prs[key] || (set.weight || 0) > prs[key].weight) prs[key] = { weight: set.weight || 0, reps: set.reps };
              }
            }
          }
          return { prs, period_days: days };
        }
        if (args.analysisType === 'frequency') {
          const freq: Record<string, number> = {};
          for (const session of recent) {
            for (const ex of session.exercises) {
              const bp = EXERCISE_DATABASE.find(e => e.id === ex.exerciseId)?.primaryBodyPart || 'Other';
              freq[bp] = (freq[bp] || 0) + 1;
            }
          }
          return { frequency: freq, period_days: days };
        }
        if (args.analysisType === 'volume_by_muscle') {
          const vol: Record<string, number> = {};
          for (const session of recent) {
            for (const ex of session.exercises) {
              const bp = EXERCISE_DATABASE.find(e => e.id === ex.exerciseId)?.primaryBodyPart || 'Other';
              vol[bp] = (vol[bp] || 0) + ex.sets.length;
            }
          }
          return { sets_by_muscle: vol, period_days: days };
        }
        return { workouts: recent.length };
      }
      default:
        return { error: `Action "${tc.name}" is not allowed.` };
    }
  }, [storage]);

  const sendMessage = useCallback(async (text: string) => {
    // Cooldown check
    if (Date.now() < sendDisabledUntil.current) return;
    sendDisabledUntil.current = Date.now() + COOLDOWN_MS;
    setCooldownActive(true);
    setTimeout(() => setCooldownActive(false), COOLDOWN_MS);

    // Daily limit check (client-side, server also enforces)
    if (dailyUsage.limitReached) return;

    // Disabled due to consecutive errors
    if (Date.now() < disabledUntil) return;

    // Cap input to 500 chars
    const cappedText = text.slice(0, 500);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: cappedText };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    const context = buildContext(cappedText);

    // Window: only send last MESSAGE_WINDOW messages
    const allMessages = [...messages, userMsg];
    const windowedMessages = allMessages.slice(-MESSAGE_WINDOW).map(m => ({ role: m.role, content: m.content }));

    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: windowedMessages, context }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        if (err.limit_reached) {
          setDailyUsage(prev => ({ ...prev, limitReached: true, count: prev.limit }));
        }
        throw new Error(err.error || `Error ${resp.status}`);
      }

      // Reset consecutive errors on success
      setConsecutiveErrors(0);

      // Update daily usage count
      setDailyUsage(prev => ({ ...prev, count: prev.count + 1, limitReached: prev.count + 1 >= prev.limit }));

      // Parse SSE stream
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let assistantContent = "";
      let toolCalls: any[] = [];

      const updateAssistant = () => {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.isLoading) {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
          }
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: assistantContent, isLoading: true }];
        });
      };

      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: '', isLoading: true }]);

      let streamDone = false;
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") { streamDone = true; break; }

          try {
            const parsed = JSON.parse(jsonStr);
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;
            if (delta?.content) { assistantContent += delta.content; updateAssistant(); }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.index !== undefined) {
                  if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: tc.id || '', name: '', arguments: '' };
                  if (tc.id) toolCalls[tc.index].id = tc.id;
                  if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                  if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
                }
              }
            }

            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') streamDone = true;
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Process tool calls
      if (toolCalls.length > 0) {
        const parsedToolCalls: ToolCall[] = toolCalls
          .filter(tc => tc && tc.name)
          .map(tc => ({
            id: tc.id, name: tc.name,
            arguments: (() => { try { return JSON.parse(tc.arguments); } catch { return {}; } })(),
            status: 'pending' as const,
          }));

        const results: any[] = [];
        for (const tc of parsedToolCalls) {
          tc.status = 'executing';
          try {
            const result = await executeToolCall(tc);
            tc.result = result;
            tc.status = result?.needs_confirmation ? 'confirm' : 'done';
            results.push({ tool_call_id: tc.id, result });
          } catch (err) {
            tc.status = 'error';
            tc.result = { error: String(err) };
            results.push({ tool_call_id: tc.id, result: { error: String(err) } });
          }
        }

        const needsConfirm = parsedToolCalls.some(tc => tc.status === 'confirm');
        if (needsConfirm) {
          const confirmTc = parsedToolCalls.find(tc => tc.status === 'confirm')!;
          const confirmContent = assistantContent || `I'll ${confirmTc.arguments.action} "${confirmTc.arguments.itemName}". This can't be undone. Go ahead?`;
          setMessages(prev => prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: confirmContent, isLoading: false, toolCalls: parsedToolCalls } : m
          ));
        } else {
          const followUpMessages = [
            ...windowedMessages,
            {
              role: 'assistant' as const,
              content: assistantContent || null,
              tool_calls: parsedToolCalls.map(tc => ({
                id: tc.id, type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            },
          ];

          const followResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
            body: JSON.stringify({ messages: followUpMessages, context, action_results: results }),
          });

          if (followResp.ok) {
            const followReader = followResp.body!.getReader();
            let followBuffer = "";
            let followContent = "";
            let done2 = false;
            while (!done2) {
              const { done, value } = await followReader.read();
              if (done) break;
              followBuffer += decoder.decode(value, { stream: true });
              let nlIdx: number;
              while ((nlIdx = followBuffer.indexOf("\n")) !== -1) {
                let fLine = followBuffer.slice(0, nlIdx);
                followBuffer = followBuffer.slice(nlIdx + 1);
                if (fLine.endsWith("\r")) fLine = fLine.slice(0, -1);
                if (!fLine.startsWith("data: ")) continue;
                const fJson = fLine.slice(6).trim();
                if (fJson === "[DONE]") { done2 = true; break; }
                try {
                  const fp = JSON.parse(fJson);
                  const fc = fp.choices?.[0]?.delta?.content;
                  if (fc) {
                    followContent += fc;
                    setMessages(prev => prev.map((m, i) =>
                      i === prev.length - 1 ? { ...m, content: followContent, toolCalls: parsedToolCalls } : m
                    ));
                  }
                } catch { break; }
              }
            }

            if (followContent) {
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: followContent, isLoading: false, toolCalls: parsedToolCalls } : m
              ));
            } else {
              const summary = parsedToolCalls.map(tc => tc.result?.message || `${tc.name} completed`).join('. ');
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: summary, isLoading: false, toolCalls: parsedToolCalls } : m
              ));
            }
          }
        }
      } else {
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: assistantContent, isLoading: false } : m
        ));
      }
    } catch (err) {
      console.error('Chat error:', err);
      const newErrorCount = consecutiveErrors + 1;
      setConsecutiveErrors(newErrorCount);

      // After 2 consecutive failures, disable for 5 minutes
      if (newErrorCount >= 2) {
        setDisabledUntil(Date.now() + DISABLE_DURATION_MS);
        setMessages(prev => {
          const errMsg = "AI is temporarily unavailable. You can still build templates manually. Will retry in 5 minutes.";
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: errMsg, isLoading: false } : m);
          }
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: errMsg, isLoading: false }];
        });
      } else {
        setMessages(prev => {
          const errMsg = `Something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}. Try again.`;
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: errMsg, isLoading: false } : m);
          }
          return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: errMsg, isLoading: false }];
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [messages, buildContext, executeToolCall, dailyUsage, consecutiveErrors, disabledUntil]);

  const confirmAction = useCallback(async (toolCallId: string, confirmed: boolean) => {
    if (!confirmed) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: "No problem, cancelled.", isLoading: false }]);
      return;
    }
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'user', content: 'Yes, go ahead.' }]);
    await sendMessage('Yes, go ahead.');
  }, [messages, sendMessage]);

  const clearChat = useCallback(() => setMessages([]), []);

  return (
    <ChatContext.Provider value={{
      messages, isOpen, isLoading, currentScreen,
      setOpen, sendMessage, clearChat, registerScreen, confirmAction, quickChips,
      dailyUsage, consecutiveErrors, cooldownActive,
    }}>
      {children}
    </ChatContext.Provider>
  );
};
