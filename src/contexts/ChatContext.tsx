import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { supabase } from '@/integrations/supabase/client';
import { getSessionController, isSessionActive } from '@/hooks/useSessionController';
import { formatLocalDate } from '@/utils/dateUtils';
import {
  weeklyRpeTrend, exerciseProgression, exerciseRpeTrend,
  weeklyVolumeByExercise, consistencyStats, recentNotes, recoverySummary,
} from '@/utils/historyAnalysis';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  isLoading?: boolean;
}

interface ExerciseInput {
  exerciseId: string;
  exerciseName?: string;
  sets?: number;
  targetReps?: number;
  setType?: string;
  restSeconds?: number;
  targetRpe?: number;
}

interface ProgramDayInput {
  label: string;
  templateId: string;
  frequency?: { type: 'weekly'; weekday: number };
}

export interface ToolCallResult {
  success?: boolean;
  message?: string;
  error?: string;
  proposalId?: string;
  templateId?: string;
  programId?: string;
  prs?: Record<string, { weight: number; reps: number; rpe?: number }>;
  period_days?: number;
  requested_days?: number;
  actual_days?: number;
  clamped_to?: 'membership' | 'max' | null;
  total_workouts?: number;
  total_volume?: number;
  total_sets?: number;
  total_reps?: number;
  avg_duration_min?: number;
  frequency?: Record<string, number>;
  sets_by_muscle?: Record<string, number>;
  workouts?: number;
  validation_errors?: string[];
  suggestions?: string[];
  // Expanded analyses (opaque to the server; consumed only by Claude)
  weekly?: unknown;
  overall_avg_rpe?: number | null;
  exercise_id?: string;
  exercise_name?: string;
  sessions?: unknown;
  workouts_per_week_avg?: number;
  longest_streak?: number;
  current_streak?: number;
  streak_mode?: string;
  training_days?: number;
  rest_days?: number;
  total_days?: number;
  workout_notes?: { date: string; note: string }[];
  exercise_notes?: { date: string; exercise_name: string; note: string }[];
  activities?: { date: string; activity_id: string; duration_min?: number; notes?: string }[];
}

type ToolCallStatus = 'pending' | 'executing' | 'done' | 'error';

type TC<N extends string, A> = {
  id: string;
  name: N;
  arguments: A;
  result?: ToolCallResult;
  status: ToolCallStatus;
};

export type ToolCall =
  | TC<'create_template', { name: string; exercises: ExerciseInput[] }>
  | TC<'edit_template', { templateId: string; name?: string; exercises?: ExerciseInput[] }>
  | TC<'delete_template', { templateId: string }>
  | TC<'create_program', { name: string; days: ProgramDayInput[]; durationWeeks?: number; startDate?: string }>
  | TC<'delete_program', { programId: string }>
  | TC<'set_active_program', { programId: string }>
  | TC<'get_workout_history', {
      days?: number;
      analysisType?: 'summary' | 'prs' | 'frequency' | 'volume_by_muscle'
        | 'rpe_trend' | 'exercise_progression' | 'exercise_rpe'
        | 'weekly_volume_by_exercise' | 'consistency' | 'notes' | 'recovery';
      exerciseId?: string;
    }>
  | TC<'add_exercise_to_workout', { exerciseId: string; exerciseName?: string; sets?: number; targetReps?: number; weight?: number }>
  | TC<'add_sets_to_exercise', { exerciseId: string; exerciseName?: string; count?: number }>
  | TC<'update_set_weight_reps', { exerciseId: string; exerciseName?: string; setNumber: number; weight?: number; reps?: number }>
  | TC<'swap_exercise_in_workout', { exerciseId: string; exerciseName?: string; newExerciseId: string; newExerciseName?: string }>;

export interface SessionExerciseRow {
  exerciseId: string;
  exerciseName: string;
  sets: { setNumber: number; weight?: number; reps?: number; type?: string; completed?: boolean }[];
}

export type ProposalSnapshot =
  | { kind: 'template'; template: { id: string; name: string; exercises: ExerciseInput[] } | null }
  | { kind: 'program'; program: { id: string; name: string; days: ProgramDayInput[]; durationWeeks?: number } | null }
  | { kind: 'active-program'; programId: string | null; programName: string | null }
  | { kind: 'session'; rows: SessionExerciseRow[] };

export interface Proposal {
  id: string;
  messageId: string;
  toolName: ToolCall['name'];
  arguments: any;
  before: ProposalSnapshot;
  after: ProposalSnapshot;
  status: 'pending' | 'applied' | 'discarded' | 'invalid';
  error?: string;
  suggestions?: string[];
  summary: string;
  appliedAt?: number;
}

interface RawToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
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
  quickChips: string[];
  dailyUsage: { count: number; limit: number; limitReached: boolean };
  consecutiveErrors: number;
  cooldownActive: boolean;
  proposals: Record<string, Proposal>;
  proposalIdsByMessage: Record<string, string[]>;
  applyProposal: (id: string) => Promise<void>;
  discardProposal: (id: string) => void;
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
  quickChips: [],
  dailyUsage: { count: 0, limit: 30, limitReached: false },
  consecutiveErrors: 0,
  cooldownActive: false,
  proposals: {},
  proposalIdsByMessage: {},
  applyProposal: async () => {},
  discardProposal: () => {},
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
  'get_workout_history',
  'add_exercise_to_workout', 'add_sets_to_exercise',
  'update_set_weight_reps', 'swap_exercise_in_workout',
]);

// Strict ID-only validation. The fuzzy match is kept ONLY as a suggestion
// payload so Claude can self-correct on the next turn — it never resolves.
function fuzzySuggestions(needle: string): string[] {
  const term = needle.toLowerCase();
  if (!term) return [];
  return EXERCISE_DATABASE
    .filter(e => e.name.toLowerCase().includes(term) || term.includes(e.name.toLowerCase()))
    .slice(0, 5)
    .map(e => e.name);
}

function validateExerciseReference(exerciseId: string, exerciseName?: string): { valid: boolean; error?: string; suggestions?: string[] } {
  if (exerciseId && EXERCISE_BY_ID.has(exerciseId)) return { valid: true };
  const suggestions = fuzzySuggestions(exerciseName || exerciseId || '');
  return {
    valid: false,
    suggestions,
    error: `Missing or unknown exerciseId "${exerciseId || ''}". Use an id from available_exercises.${suggestions.length ? ' Did you mean: ' + suggestions.join(', ') + '?' : ''}`,
  };
}

function validateAllExercises(exercises: ExerciseInput[]): { valid: boolean; validated: ExerciseInput[]; errors: string[]; suggestions: string[] } {
  const errors: string[] = [];
  const allSuggestions: string[] = [];
  const validated: ExerciseInput[] = [];
  for (const e of exercises) {
    const result = validateExerciseReference(e.exerciseId, e.exerciseName);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestions) allSuggestions.push(...result.suggestions);
      continue;
    }
    validated.push(e);
  }
  return { valid: errors.length === 0, validated, errors, suggestions: Array.from(new Set(allSuggestions)) };
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
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [proposalIdsByMessage, setProposalIdsByMessage] = useState<Record<string, string[]>>({});
  const [memberSince, setMemberSince] = useState<string | null>(null);

  const registerScreen = useCallback((ctx: ScreenContext) => {
    screenRef.current = ctx;
    setCurrentScreen(ctx.screen);
  }, []);

  const quickChips = SCREEN_CHIPS[currentScreen] || DEFAULT_CHIPS;

  // Fetch daily usage + membership start on mount
  useEffect(() => {
    const fetchUsage = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (user.created_at) setMemberSince(user.created_at.substring(0, 10));
      const today = formatLocalDate();
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

  const daysSinceMember = useCallback((): number | null => {
    if (!memberSince) return null;
    const start = new Date(memberSince + 'T00:00:00');
    const ms = Date.now() - start.getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }, [memberSince]);

  const buildContext = useCallback(() => {
    const memberDays = daysSinceMember();
    const historyMax = memberDays != null ? Math.min(365, memberDays) : 365;

    const ctx: any = {
      current_screen: screenRef.current.screen,
      current_data: screenRef.current.data || {},
      available_exercises: exerciseListLean,
      user_profile: {
        display_name: storage.profile?.displayName ?? null,
        weight_unit: storage.preferences?.weightUnit ?? 'lbs',
        member_since: memberSince,
        days_since_member: memberDays,
        history_window_max_days: historyMax,
        total_sessions_logged: storage.history?.length ?? 0,
      },
    };

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
  }, [storage, memberSince, daysSinceMember]);

  const getSessionRows = useCallback((): SessionExerciseRow[] => {
    if (!isSessionActive()) return [];
    const controller = getSessionController();
    if (!controller) return [];
    return controller.getBlocks().map(b => ({
      exerciseId: b.exerciseId,
      exerciseName: b.exerciseName,
      sets: b.sets.map(s => ({ setNumber: s.setNumber, weight: s.weight, reps: s.reps, type: s.type, completed: s.completed })),
    }));
  }, []);

  const proposeToolCall = useCallback(async (tc: ToolCall, messageId: string): Promise<{ result: ToolCallResult; proposal?: Proposal }> => {
    if (!AI_ALLOWED_ACTIONS.has(tc.name)) {
      return { result: { error: `Action "${tc.name}" is not allowed. I can only perform actions available through the app's UI.` } };
    }

    const mkInvalid = (snapshot: ProposalSnapshot, error: string, suggestions: string[] = []): { result: ToolCallResult; proposal: Proposal } => {
      const proposal: Proposal = {
        id: tc.id,
        messageId,
        toolName: tc.name,
        arguments: tc.arguments,
        before: snapshot,
        after: snapshot,
        status: 'invalid',
        error,
        suggestions,
        summary: `Invalid ${tc.name.replace(/_/g, ' ')} proposal`,
      };
      return { result: { success: false, message: error, validation_errors: [error], suggestions }, proposal };
    };

    switch (tc.name) {
      case 'create_template': {
        const args = tc.arguments;
        if (!args.name || !Array.isArray(args.exercises) || args.exercises.length === 0) {
          return mkInvalid({ kind: 'template', template: null }, 'Template requires a name and at least one exercise.');
        }
        const { valid, validated, errors, suggestions } = validateAllExercises(args.exercises);
        if (!valid) return mkInvalid({ kind: 'template', template: null }, errors.join('\n'), suggestions);
        const newId = crypto.randomUUID();
        const after = {
          id: newId,
          name: args.name,
          exercises: validated.map(e => ({
            exerciseId: e.exerciseId,
            exerciseName: EXERCISE_BY_ID.get(e.exerciseId)?.name || e.exerciseId,
            sets: e.sets,
            targetReps: e.targetReps,
            setType: e.setType || 'normal',
            restSeconds: e.restSeconds ?? 90,
            targetRpe: e.targetRpe,
          })),
        };
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before: { kind: 'template', template: null },
          after: { kind: 'template', template: after },
          status: 'pending',
          summary: `Create template "${args.name}" with ${validated.length} exercise${validated.length === 1 ? '' : 's'}`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'edit_template': {
        const args = tc.arguments;
        if (!args.templateId) return mkInvalid({ kind: 'template', template: null }, 'Template ID is required.');
        const existing = storage.templates.find((t: any) => t.id === args.templateId);
        if (!existing) return mkInvalid({ kind: 'template', template: null }, `Template "${args.templateId}" not found.`);
        const before = { kind: 'template' as const, template: { id: existing.id, name: existing.name, exercises: existing.exercises } };
        let exercises = existing.exercises;
        if (args.exercises?.length) {
          const { valid, validated, errors, suggestions } = validateAllExercises(args.exercises);
          if (!valid) return mkInvalid(before, errors.join('\n'), suggestions);
          exercises = validated.map(e => ({
            exerciseId: e.exerciseId,
            exerciseName: EXERCISE_BY_ID.get(e.exerciseId)?.name || e.exerciseId,
            sets: e.sets,
            targetReps: e.targetReps,
            setType: e.setType || 'normal',
            restSeconds: e.restSeconds ?? 90,
            targetRpe: e.targetRpe,
          }));
        }
        const after = { ...existing, name: args.name || existing.name, exercises };
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before,
          after: { kind: 'template', template: { id: after.id, name: after.name, exercises: after.exercises } },
          status: 'pending',
          summary: `Edit template "${after.name}"`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'delete_template': {
        const args = tc.arguments;
        if (!args.templateId) return mkInvalid({ kind: 'template', template: null }, 'Template ID is required.');
        const existing = storage.templates.find((t: any) => t.id === args.templateId);
        if (!existing) return mkInvalid({ kind: 'template', template: null }, `Template "${args.templateId}" not found.`);
        const before = { kind: 'template' as const, template: { id: existing.id, name: existing.name, exercises: existing.exercises } };
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before,
          after: { kind: 'template', template: null },
          status: 'pending',
          summary: `Delete template "${existing.name}"`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'create_program': {
        const args = tc.arguments;
        if (!args.name || !Array.isArray(args.days) || args.days.length === 0) {
          return mkInvalid({ kind: 'program', program: null }, 'Program requires a name and at least one day.');
        }
        const newId = crypto.randomUUID();
        const after = { id: newId, name: args.name, days: args.days, durationWeeks: args.durationWeeks ?? 8 };
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before: { kind: 'program', program: null },
          after: { kind: 'program', program: after },
          status: 'pending',
          summary: `Create program "${args.name}" (${args.days.length} days)`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'delete_program': {
        const args = tc.arguments;
        if (!args.programId) return mkInvalid({ kind: 'program', program: null }, 'Program ID is required.');
        const existing = storage.programs.find((p: any) => p.id === args.programId);
        if (!existing) return mkInvalid({ kind: 'program', program: null }, `Program "${args.programId}" not found.`);
        const before = { kind: 'program' as const, program: { id: existing.id, name: existing.name, days: existing.days, durationWeeks: existing.durationWeeks } };
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before,
          after: { kind: 'program', program: null },
          status: 'pending',
          summary: `Delete program "${existing.name}"`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'set_active_program': {
        const args = tc.arguments;
        if (!args.programId) return mkInvalid({ kind: 'active-program', programId: null, programName: null }, 'Program ID is required.');
        const target = storage.programs.find((p: any) => p.id === args.programId);
        if (!target) return mkInvalid({ kind: 'active-program', programId: null, programName: null }, `Program "${args.programId}" not found.`);
        const currentActiveId: string | null = storage.activeProgramId ?? null;
        const currentActive = currentActiveId ? storage.programs.find((p: any) => p.id === currentActiveId) : null;
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before: { kind: 'active-program', programId: currentActiveId, programName: currentActive?.name ?? null },
          after: { kind: 'active-program', programId: target.id, programName: target.name },
          status: 'pending',
          summary: `Set active program to "${target.name}"`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'add_exercise_to_workout': {
        const args = tc.arguments;
        const validation = validateExerciseReference(args.exerciseId, args.exerciseName);
        if (!validation.valid) return mkInvalid({ kind: 'session', rows: getSessionRows() }, validation.error!, validation.suggestions);
        if (!isSessionActive()) return mkInvalid({ kind: 'session', rows: [] }, 'No active workout session. Start a workout first.');
        const rows = getSessionRows();
        if (rows.some(r => r.exerciseId === args.exerciseId)) {
          return mkInvalid({ kind: 'session', rows }, 'Exercise is already in the workout.');
        }
        const exName = EXERCISE_BY_ID.get(args.exerciseId)!.name;
        const sets = args.sets ?? 3;
        const newRow: SessionExerciseRow = {
          exerciseId: args.exerciseId,
          exerciseName: exName,
          sets: Array.from({ length: sets }, (_, i) => ({ setNumber: i + 1, weight: args.weight, reps: args.targetReps, type: 'normal', completed: false })),
        };
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before: { kind: 'session', rows },
          after: { kind: 'session', rows: [...rows, newRow] },
          status: 'pending',
          summary: `Add ${exName} to your workout`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'add_sets_to_exercise': {
        const args = tc.arguments;
        if (!isSessionActive()) return mkInvalid({ kind: 'session', rows: [] }, 'No active workout session.');
        const rows = getSessionRows();
        const targetRow = rows.find(r => r.exerciseId === args.exerciseId);
        if (!targetRow) return mkInvalid({ kind: 'session', rows }, `Exercise id "${args.exerciseId}" is not in the current workout.`);
        const count = args.count ?? 1;
        const lastSetNumber = targetRow.sets.length;
        const newSets = Array.from({ length: count }, (_, i) => ({ setNumber: lastSetNumber + i + 1, type: 'normal' as const, completed: false }));
        const after = rows.map(r => r.exerciseId === args.exerciseId ? { ...r, sets: [...r.sets, ...newSets] } : r);
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before: { kind: 'session', rows },
          after: { kind: 'session', rows: after },
          status: 'pending',
          summary: `Add ${count} set${count === 1 ? '' : 's'} to ${targetRow.exerciseName}`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'update_set_weight_reps': {
        const args = tc.arguments;
        if (!isSessionActive()) return mkInvalid({ kind: 'session', rows: [] }, 'No active workout session.');
        const rows = getSessionRows();
        const targetRow = rows.find(r => r.exerciseId === args.exerciseId);
        if (!targetRow) return mkInvalid({ kind: 'session', rows }, `Exercise id "${args.exerciseId}" is not in the current workout.`);
        if (!targetRow.sets.some(s => s.setNumber === args.setNumber)) {
          return mkInvalid({ kind: 'session', rows }, `Set ${args.setNumber} of ${targetRow.exerciseName} does not exist.`);
        }
        const after = rows.map(r => r.exerciseId === args.exerciseId
          ? { ...r, sets: r.sets.map(s => s.setNumber === args.setNumber ? { ...s, weight: args.weight ?? s.weight, reps: args.reps ?? s.reps } : s) }
          : r);
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before: { kind: 'session', rows },
          after: { kind: 'session', rows: after },
          status: 'pending',
          summary: `Update set ${args.setNumber} of ${targetRow.exerciseName}`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'swap_exercise_in_workout': {
        const args = tc.arguments;
        const newValidation = validateExerciseReference(args.newExerciseId, args.newExerciseName);
        if (!newValidation.valid) return mkInvalid({ kind: 'session', rows: getSessionRows() }, newValidation.error!, newValidation.suggestions);
        if (!isSessionActive()) return mkInvalid({ kind: 'session', rows: [] }, 'No active workout session.');
        const rows = getSessionRows();
        const targetRow = rows.find(r => r.exerciseId === args.exerciseId);
        if (!targetRow) return mkInvalid({ kind: 'session', rows }, `Exercise id "${args.exerciseId}" is not in the current workout.`);
        const newName = EXERCISE_BY_ID.get(args.newExerciseId)!.name;
        const after = rows.map(r => r.exerciseId === args.exerciseId
          ? { ...r, exerciseId: args.newExerciseId, exerciseName: newName }
          : r);
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before: { kind: 'session', rows },
          after: { kind: 'session', rows: after },
          status: 'pending',
          summary: `Swap ${targetRow.exerciseName} for ${newName}`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'get_workout_history': {
        const args = tc.arguments;
        const requestedDays = args.days ?? 14;
        const memberDays = daysSinceMember();
        const ceiling = Math.min(365, memberDays ?? 365);
        const days = Math.max(1, Math.min(requestedDays, ceiling));
        const clamped: 'membership' | 'max' | null =
          days < requestedDays
            ? (memberDays != null && days === memberDays ? 'membership' : 'max')
            : null;

        const meta = { period_days: days, requested_days: requestedDays, actual_days: days, clamped_to: clamped };

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = formatLocalDate(cutoff);
        const recent = storage.history.filter((s: any) => s.date >= cutoffStr && !s.isRestDay);
        const allHistory = storage.history as any[];

        const needsExercise = (
          args.analysisType === 'exercise_progression' ||
          args.analysisType === 'exercise_rpe' ||
          args.analysisType === 'weekly_volume_by_exercise'
        );
        if (needsExercise) {
          const v = validateExerciseReference(args.exerciseId ?? '', undefined);
          if (!v.valid) {
            return { result: { ...meta, success: false, message: v.error, suggestions: v.suggestions } };
          }
        }

        switch (args.analysisType) {
          case 'summary':
            return { result: {
              ...meta,
              total_workouts: recent.length,
              total_volume: recent.reduce((s: number, w: any) => s + w.totalVolume, 0),
              total_sets: recent.reduce((s: number, w: any) => s + w.totalSets, 0),
              total_reps: recent.reduce((s: number, w: any) => s + w.totalReps, 0),
              avg_duration_min: recent.length ? Math.round(recent.reduce((s: number, w: any) => s + w.duration, 0) / recent.length / 60) : 0,
            }};

          case 'prs': {
            const prs: Record<string, { weight: number; reps: number; rpe?: number }> = {};
            for (const session of recent) {
              for (const ex of session.exercises) {
                for (const set of ex.sets) {
                  if (set.type === 'warmup') continue;
                  const key = ex.exerciseName || ex.exerciseId;
                  if (!prs[key] || (set.weight || 0) > prs[key].weight) {
                    prs[key] = { weight: set.weight || 0, reps: set.reps, ...(set.rpe ? { rpe: set.rpe } : {}) };
                  }
                }
              }
            }
            return { result: { ...meta, prs } };
          }

          case 'frequency': {
            const freq: Record<string, number> = {};
            for (const session of recent) {
              for (const ex of session.exercises) {
                const bp = EXERCISE_DATABASE.find(e => e.id === ex.exerciseId)?.primaryBodyPart || 'Other';
                freq[bp] = (freq[bp] || 0) + 1;
              }
            }
            return { result: { ...meta, frequency: freq } };
          }

          case 'volume_by_muscle': {
            const vol: Record<string, number> = {};
            for (const session of recent) {
              for (const ex of session.exercises) {
                const bp = EXERCISE_DATABASE.find(e => e.id === ex.exerciseId)?.primaryBodyPart || 'Other';
                vol[bp] = (vol[bp] || 0) + ex.sets.length;
              }
            }
            return { result: { ...meta, sets_by_muscle: vol } };
          }

          case 'rpe_trend': {
            const trend = weeklyRpeTrend(allHistory, days);
            return { result: { ...meta, weekly: trend.weekly, overall_avg_rpe: trend.overall_avg_rpe, total_sets: trend.total_sets } };
          }

          case 'exercise_progression': {
            const exName = EXERCISE_BY_ID.get(args.exerciseId!)?.name || args.exerciseId!;
            const prog = exerciseProgression(allHistory, args.exerciseId!, exName, days);
            return { result: { ...meta, exercise_id: prog.exercise_id, exercise_name: prog.exercise_name, sessions: prog.sessions } };
          }

          case 'exercise_rpe': {
            const trend = exerciseRpeTrend(allHistory, args.exerciseId!, days);
            return { result: { ...meta, exercise_id: trend.exercise_id, weekly: trend.weekly, overall_avg_rpe: trend.overall_avg_rpe, total_sets: trend.total_sets } };
          }

          case 'weekly_volume_by_exercise': {
            const exName = EXERCISE_BY_ID.get(args.exerciseId!)?.name || args.exerciseId!;
            const wv = weeklyVolumeByExercise(allHistory, args.exerciseId!, exName, days);
            return { result: { ...meta, exercise_id: wv.exercise_id, exercise_name: wv.exercise_name, weekly: wv.weekly } };
          }

          case 'consistency': {
            const mode = (storage.preferences?.streakMode as 'daily' | 'weekly') ?? 'daily';
            const target = storage.preferences?.streakWeeklyTarget ?? 3;
            const c = consistencyStats(allHistory, days, mode, target);
            return { result: { ...meta, ...c } };
          }

          case 'notes': {
            const n = recentNotes(allHistory, days, 20);
            return { result: { ...meta, workout_notes: n.workout_notes, exercise_notes: n.exercise_notes } };
          }

          case 'recovery': {
            const r = recoverySummary(allHistory, days);
            return { result: { ...meta, rest_days: r.rest_days, activities: r.activities } };
          }

          default:
            return { result: { ...meta, workouts: recent.length } };
        }
      }

      default:
        return { result: { error: `Action is not allowed.` } };
    }
  }, [storage, getSessionRows, daysSinceMember]);

  const applyProposal = useCallback(async (id: string) => {
    const proposal = proposals[id];
    if (!proposal || proposal.status !== 'pending') return;

    try {
      switch (proposal.toolName) {
        case 'create_template':
        case 'edit_template': {
          if (proposal.after.kind !== 'template' || !proposal.after.template) return;
          const t = proposal.after.template;
          await storage.saveTemplate({
            id: t.id,
            name: t.name,
            exercises: t.exercises.map(e => ({
              exerciseId: e.exerciseId,
              sets: e.sets,
              targetReps: e.targetReps,
              setType: e.setType || 'normal',
              restSeconds: e.restSeconds ?? 90,
              targetRpe: e.targetRpe,
            })),
          });
          break;
        }
        case 'delete_template': {
          if (proposal.before.kind !== 'template' || !proposal.before.template) return;
          await storage.deleteTemplate(proposal.before.template.id);
          break;
        }
        case 'create_program': {
          if (proposal.after.kind !== 'program' || !proposal.after.program) return;
          const p = proposal.after.program;
          await storage.saveProgram({
            id: p.id,
            name: p.name,
            days: p.days,
            durationWeeks: p.durationWeeks ?? 8,
            startDate: proposal.arguments?.startDate || formatLocalDate(),
          });
          break;
        }
        case 'delete_program': {
          if (proposal.before.kind !== 'program' || !proposal.before.program) return;
          await storage.deleteProgram(proposal.before.program.id);
          break;
        }
        case 'set_active_program': {
          if (proposal.after.kind !== 'active-program' || !proposal.after.programId) return;
          await storage.setActiveProgram(proposal.after.programId);
          break;
        }
        case 'add_exercise_to_workout': {
          const args = proposal.arguments;
          const controller = getSessionController();
          if (!controller) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'No active workout session.' } }));
            return;
          }
          const ok = controller.addExercise(args.exerciseId, args.sets || 3, args.targetReps, args.weight);
          if (!ok) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Exercise is already in the workout.' } }));
            return;
          }
          break;
        }
        case 'add_sets_to_exercise': {
          const args = proposal.arguments;
          const controller = getSessionController();
          if (!controller) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'No active workout session.' } }));
            return;
          }
          const blocks = controller.getBlocks();
          const targetBlock = blocks.find(b => b.exerciseId === args.exerciseId);
          if (!targetBlock) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Exercise is no longer in the session.' } }));
            return;
          }
          const ok = controller.addSets(targetBlock.exerciseName, args.count || 1);
          if (!ok) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Could not add sets.' } }));
            return;
          }
          break;
        }
        case 'update_set_weight_reps': {
          const args = proposal.arguments;
          const controller = getSessionController();
          if (!controller) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'No active workout session.' } }));
            return;
          }
          const blocks = controller.getBlocks();
          const targetBlock = blocks.find(b => b.exerciseId === args.exerciseId);
          if (!targetBlock) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Exercise is no longer in the session.' } }));
            return;
          }
          const ok = controller.updateSet(targetBlock.exerciseName, args.setNumber, { weight: args.weight, reps: args.reps });
          if (!ok) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Session changed since proposal — could not update set.' } }));
            return;
          }
          break;
        }
        case 'swap_exercise_in_workout': {
          const args = proposal.arguments;
          const controller = getSessionController();
          if (!controller) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'No active workout session.' } }));
            return;
          }
          const blocks = controller.getBlocks();
          const targetBlock = blocks.find(b => b.exerciseId === args.exerciseId);
          if (!targetBlock) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Exercise is no longer in the session.' } }));
            return;
          }
          const ok = controller.swapExercise(targetBlock.exerciseName, args.newExerciseId);
          if (!ok) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Session changed since proposal — could not swap.' } }));
            return;
          }
          break;
        }
      }
      setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'applied', appliedAt: Date.now() } }));
      const note: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: `_Applied: ${proposal.summary}_` };
      setMessages(prev => [...prev, note]);
    } catch (err) {
      console.error('applyProposal error:', err);
      setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: String(err) } }));
    }
  }, [proposals, storage]);

  const discardProposal = useCallback((id: string) => {
    const proposal = proposals[id];
    if (!proposal || proposal.status !== 'pending') return;
    setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'discarded' } }));
    const note: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: `_Discarded: ${proposal.summary}_` };
    setMessages(prev => [...prev, note]);
  }, [proposals]);

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

    const context = buildContext();

    // Window: only send last MESSAGE_WINDOW messages
    const allMessages = [...messages, userMsg];
    const windowedMessages = allMessages.slice(-MESSAGE_WINDOW).map(m => ({ role: m.role, content: m.content }));

    // Allocate the assistant message id up front so we can associate proposals with it.
    const assistantMessageId = crypto.randomUUID();

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
      let toolCalls: RawToolCallAccumulator[] = [];

      const updateAssistant = () => {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.isLoading) {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantContent } : m);
          }
          return [...prev, { id: assistantMessageId, role: 'assistant', content: assistantContent, isLoading: true }];
        });
      };

      setMessages(prev => [...prev, { id: assistantMessageId, role: 'assistant', content: '', isLoading: true }]);

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
          .filter((tc): tc is RawToolCallAccumulator => Boolean(tc?.name) && AI_ALLOWED_ACTIONS.has(tc.name))
          .map(tc => {
            let parsedArgs: unknown;
            try { parsedArgs = JSON.parse(tc.arguments); } catch { parsedArgs = {}; }
            return { id: tc.id, name: tc.name, arguments: parsedArgs, status: 'pending' as const } as ToolCall;
          });

        const results: { tool_call_id: string; result: ToolCallResult }[] = [];
        const newProposals: Proposal[] = [];
        for (const tc of parsedToolCalls) {
          tc.status = 'executing';
          try {
            const { result, proposal } = await proposeToolCall(tc, assistantMessageId);
            tc.result = result;
            tc.status = result?.error ? 'error' : 'done';
            results.push({ tool_call_id: tc.id, result });
            if (proposal) newProposals.push(proposal);
          } catch (err) {
            tc.status = 'error';
            tc.result = { error: String(err) };
            results.push({ tool_call_id: tc.id, result: { error: String(err) } });
          }
        }

        // Commit proposals to state so the diff cards can render under this message.
        if (newProposals.length) {
          setProposals(prev => {
            const next = { ...prev };
            for (const p of newProposals) next[p.id] = p;
            return next;
          });
          setProposalIdsByMessage(prev => ({
            ...prev,
            [assistantMessageId]: [...(prev[assistantMessageId] || []), ...newProposals.map(p => p.id)],
          }));
        }

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
                  setMessages(prev => prev.map(m =>
                    m.id === assistantMessageId ? { ...m, content: followContent, toolCalls: parsedToolCalls } : m
                  ));
                }
              } catch { break; }
            }
          }

          if (followContent) {
            setMessages(prev => prev.map(m =>
              m.id === assistantMessageId ? { ...m, content: followContent, isLoading: false, toolCalls: parsedToolCalls } : m
            ));
          } else {
            const summary = parsedToolCalls.map(tc => tc.result?.message || `${tc.name} completed`).join('. ');
            setMessages(prev => prev.map(m =>
              m.id === assistantMessageId ? { ...m, content: summary, isLoading: false, toolCalls: parsedToolCalls } : m
            ));
          }
        }
      } else {
        setMessages(prev => prev.map(m =>
          m.id === assistantMessageId ? { ...m, content: assistantContent, isLoading: false } : m
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
  }, [messages, buildContext, proposeToolCall, dailyUsage, consecutiveErrors, disabledUntil]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setProposals({});
    setProposalIdsByMessage({});
  }, []);

  return (
    <ChatContext.Provider value={{
      messages, isOpen, isLoading, currentScreen,
      setOpen, sendMessage, clearChat, registerScreen, quickChips,
      dailyUsage, consecutiveErrors, cooldownActive,
      proposals, proposalIdsByMessage, applyProposal, discardProposal,
    }}>
      {children}
    </ChatContext.Provider>
  );
};
