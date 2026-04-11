import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { EXERCISE_DATABASE } from '@/data/exercises';

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

const SCREEN_CHIPS: Record<string, string[]> = {
  programs: ["Build me a program", "Edit current program", "What should I train today?"],
  templates: ["Create a template", "Duplicate this template", "Add an exercise"],
  active_workout: ["Swap this exercise", "Add a set", "How's my volume this week?"],
  activity: ["Summarize my week", "Compare this week to last", "What are my PRs?"],
  dashboard: ["Build me a program", "Create a template", "What should I train today?"],
  analytics: ["Summarize my week", "Compare this week to last", "What are my PRs?"],
};

const DEFAULT_CHIPS = ["Build me a program", "Create a template", "What should I train today?"];

export const ChatProvider: React.FC<{
  children: React.ReactNode;
  storage: any; // useStorage return type
}> = ({ children, storage }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const screenRef = useRef<ScreenContext>({ screen: 'dashboard' });
  const [currentScreen, setCurrentScreen] = useState('dashboard');
  const sendDisabledUntil = useRef(0);

  const registerScreen = useCallback((ctx: ScreenContext) => {
    screenRef.current = ctx;
    setCurrentScreen(ctx.screen);
  }, []);

  const quickChips = SCREEN_CHIPS[currentScreen] || DEFAULT_CHIPS;

  const buildContext = useCallback(() => {
    const ctx: any = {
      current_screen: screenRef.current.screen,
      current_data: screenRef.current.data || {},
      available_exercises: exerciseListLean,
    };

    // Add user templates/programs summary
    if (storage.templates?.length > 0) {
      ctx.user_templates = storage.templates.map((t: any) => ({ id: t.id, name: t.name, exerciseCount: t.exercises?.length }));
    }
    if (storage.programs?.length > 0) {
      ctx.user_programs = storage.programs.map((p: any) => ({ id: p.id, name: p.name, days: p.days?.length }));
    }
    if (storage.activeProgramId) {
      ctx.active_program_id = storage.activeProgramId;
    }

    return ctx;
  }, [storage]);

  // Execute tool calls client-side
  const executeToolCall = useCallback(async (tc: ToolCall): Promise<any> => {
    const args = tc.arguments;
    switch (tc.name) {
      case 'create_template': {
        const template = {
          id: crypto.randomUUID(),
          name: args.name,
          exercises: args.exercises.map((e: any, i: number) => ({
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
        const updated = {
          ...existing,
          name: args.name || existing.name,
          exercises: args.exercises || existing.exercises,
        };
        await storage.saveTemplate(updated);
        return { success: true, message: `Updated template "${updated.name}".` };
      }
      case 'delete_template': {
        await storage.deleteTemplate(args.templateId);
        return { success: true, message: "Template deleted." };
      }
      case 'create_program': {
        // First create templates for any inline exercises, then create the program
        const programId = crypto.randomUUID();
        const program = {
          id: programId,
          name: args.name,
          days: args.days,
          durationWeeks: args.durationWeeks || 8,
          startDate: args.startDate || new Date().toISOString().split('T')[0],
        };
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
      case 'confirm_destructive_action': {
        // This is handled specially — we show a confirmation in the UI
        return { needs_confirmation: true, action: args.action, itemName: args.itemName };
      }
      case 'get_workout_history': {
        const days = args.days || 14;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = cutoff.toISOString().split('T')[0];
        const recent = storage.history.filter((s: any) => s.date >= cutoffStr && !s.isRestDay);

        if (args.analysisType === 'summary') {
          return {
            period_days: days,
            total_workouts: recent.length,
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
                if (!prs[key] || (set.weight || 0) > prs[key].weight) {
                  prs[key] = { weight: set.weight || 0, reps: set.reps };
                }
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
        return { error: `Unknown action: ${tc.name}` };
    }
  }, [storage]);

  const sendMessage = useCallback(async (text: string) => {
    if (Date.now() < sendDisabledUntil.current) return;
    sendDisabledUntil.current = Date.now() + 1000; // 1s debounce

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    const context = buildContext();
    const apiMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));

    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: apiMessages, context }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `Error ${resp.status}`);
      }

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

      // Add initial assistant placeholder
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
            if (delta?.content) {
              assistantContent += delta.content;
              updateAssistant();
            }

            // Collect tool calls
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.index !== undefined) {
                  if (!toolCalls[tc.index]) {
                    toolCalls[tc.index] = { id: tc.id || '', name: '', arguments: '' };
                  }
                  if (tc.id) toolCalls[tc.index].id = tc.id;
                  if (tc.function?.name) toolCalls[tc.index].name = tc.function.name;
                  if (tc.function?.arguments) toolCalls[tc.index].arguments += tc.function.arguments;
                }
              }
            }

            if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
              streamDone = true;
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Process tool calls if any
      if (toolCalls.length > 0) {
        const parsedToolCalls: ToolCall[] = toolCalls
          .filter(tc => tc && tc.name)
          .map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: (() => { try { return JSON.parse(tc.arguments); } catch { return {}; } })(),
            status: 'pending' as const,
          }));

        // Execute all tool calls
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

        // If there are confirmation-needed tool calls, show them
        const needsConfirm = parsedToolCalls.some(tc => tc.status === 'confirm');

        if (needsConfirm) {
          // Update last assistant message with the confirmation request
          const confirmTc = parsedToolCalls.find(tc => tc.status === 'confirm')!;
          const confirmContent = assistantContent || `I'll ${confirmTc.arguments.action} "${confirmTc.arguments.itemName}". This can't be undone. Go ahead?`;
          setMessages(prev => prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: confirmContent, isLoading: false, toolCalls: parsedToolCalls } : m
          ));
        } else {
          // Send tool results back to AI for a natural language response
          const followUpMessages = [
            ...apiMessages,
            {
              role: 'assistant' as const,
              content: assistantContent || null,
              tool_calls: parsedToolCalls.map(tc => ({
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
              })),
            },
          ];

          const followResp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
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
              // Fallback
              const summary = parsedToolCalls.map(tc => tc.result?.message || `${tc.name} completed`).join('. ');
              setMessages(prev => prev.map((m, i) =>
                i === prev.length - 1 ? { ...m, content: summary, isLoading: false, toolCalls: parsedToolCalls } : m
              ));
            }
          }
        }
      } else {
        // No tool calls, just finalize the message
        setMessages(prev => prev.map((m, i) =>
          i === prev.length - 1 ? { ...m, content: assistantContent, isLoading: false } : m
        ));
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant') {
          return prev.map((m, i) => i === prev.length - 1
            ? { ...m, content: `Something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}. Try again.`, isLoading: false }
            : m);
        }
        return [...prev, { id: crypto.randomUUID(), role: 'assistant', content: 'Something went wrong. Try again.', isLoading: false }];
      });
    } finally {
      setIsLoading(false);
    }
  }, [messages, buildContext, executeToolCall]);

  const confirmAction = useCallback(async (toolCallId: string, confirmed: boolean) => {
    if (!confirmed) {
      setMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: "No problem, cancelled.", isLoading: false }]);
      return;
    }

    // Find the tool call and execute the actual destructive action
    const msg = messages.find(m => m.toolCalls?.some(tc => tc.id === toolCallId));
    const tc = msg?.toolCalls?.find(t => t.id === toolCallId);
    if (!tc) return;

    // The confirm_destructive_action tool tells us what to do next
    // We need to determine the actual action from context
    // For now, the AI should call the actual delete action after confirmation
    setMessages(prev => [...prev,
      { id: crypto.randomUUID(), role: 'user', content: 'Yes, go ahead.' },
    ]);
    await sendMessage('Yes, go ahead.');
  }, [messages, sendMessage]);

  const clearChat = useCallback(() => setMessages([]), []);

  return (
    <ChatContext.Provider value={{
      messages, isOpen, isLoading, currentScreen,
      setOpen, sendMessage, clearChat, registerScreen, confirmAction, quickChips,
    }}>
      {children}
    </ChatContext.Provider>
  );
};
