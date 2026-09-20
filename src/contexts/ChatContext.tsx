import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { EXERCISE_DATABASE, type Exercise } from '@/data/exercises';
import type { SetType, WorkoutSession } from '@/types/workout';
import { supabase } from '@/integrations/supabase/client';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { getSessionController, isSessionActive, type SessionMutations } from '@/hooks/useSessionController';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import type { ActiveSessionCache, ExerciseBlock as SessionBlock, SetRow as SessionSetRow } from '@/types/activeSession';
import { formatLocalDate } from '@/utils/dateUtils';
import { volumeExcludedIds, countedSessionTotals } from '@/utils/volumeExclusions';
import { deriveBalance, EMPTY_BALANCE, type CreditsBalance } from '@/utils/credits';
import {
  weeklyRpeTrend, exerciseProgression, exerciseRpeTrend,
  weeklyVolumeByExercise, consistencyStats, recentNotes, recoverySummary,
  historyHorizonDays,
} from '@/utils/historyAnalysis';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  isLoading?: boolean;
}

export interface ExerciseInput {
  exerciseId: string;
  exerciseName?: string;
  sets?: number;
  targetReps?: number | 'failure';
  setType?: string;
  restSeconds?: number;
  targetRpe?: number;
  supersetGroup?: number;
  targetWeight?: number;
  targetDistance?: number;
}

export interface ProgramDayInput {
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
  prs?: Record<string, { exercise_id: string; weight: number; reps: number; rpe?: number }>;
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
  | TC<'add_exercises_to_template', { templateId: string; exercises: ExerciseInput[] }>
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
  // Tool args flow in from Anthropic's streamed JSON — the shape depends on
  // toolName. Narrowing this into a discriminated union across every tool is
  // a bigger refactor than this cleanup pass; callers already switch on
  // toolName and read known fields, so we accept the loose typing here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arguments: any;
  before: ProposalSnapshot;
  after: ProposalSnapshot;
  // 'applying' is 'pending' with its save in flight: the card keeps its
  // buttons but disables them, and a second Apply is a no-op.
  status: 'pending' | 'applying' | 'applied' | 'discarded' | 'invalid';
  error?: string;
  suggestions?: string[];
  summary: string;
  appliedAt?: number;
  /**
   * For the four session tools: which workout the proposal was built against
   * (`sessionWorkoutKey`). Apply refuses a different one, so a card left over
   * from a workout that was discarded and replaced cannot land its change in
   * the new workout. Null when no workout was in progress.
   */
  sessionKey?: string | null;
}

interface RawToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

// What one assistant round of a turn produced, before its tool calls are
// parsed: the prose, the raw tool-call accumulators (indexed as the stream
// indexes them), whether the model was cut off at max_tokens, and the
// server's sentence if the stream died partway through.
interface RoundResult {
  content: string;
  rawToolCalls: (RawToolCallAccumulator | undefined)[];
  truncated: boolean;
  streamError: string | null;
}

interface ActionResult {
  tool_call_id: string;
  result: ToolCallResult;
}

// The OpenAI-shaped history the client sends as `messages`, which ai-coach's
// toAnthropicMessages converts. A turn's later rounds send back the assistant
// turns it has already produced and the tool results that answered them.
type OutboundMessage =
  | {
      role: 'user' | 'assistant';
      content: string | null;
      tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

interface ScreenContext {
  screen: string;
  data?: unknown;
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
  creditsBalance: CreditsBalance;
  // Whether creditsBalance is a figure the server gave us. False means no read
  // has succeeded yet (offline, expired token, 5xx) and the numbers are the
  // pre-load placeholder — do not present them as the user's allowance.
  creditsBalanceKnown: boolean;
  refreshBalance: () => Promise<void>;
  consecutiveErrors: number;
  cooldownActive: boolean;
  // Epoch ms until which the coach is locked out after consecutive failures;
  // 0 when it is not. Clears itself on a timer, so gate on this rather than
  // on consecutiveErrors.
  lockedUntil: number;
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
  creditsBalance: EMPTY_BALANCE,
  creditsBalanceKnown: false,
  refreshBalance: async () => {},
  consecutiveErrors: 0,
  cooldownActive: false,
  lockedUntil: 0,
  proposals: {},
  proposalIdsByMessage: {},
  applyProposal: async () => {},
  discardProposal: () => {},
});

export const useChatContext = () => useContext(ChatContext);

type ExerciseLike = Exercise & { isCustom?: boolean; excludeFromVolume?: boolean };

function buildExerciseListLean(list: ExerciseLike[]) {
  return list.map(e => ({
    exercise: e.name,
    id: e.id,
    primary_body_part: e.primaryBodyPart,
    equipment: e.equipment,
    exercise_type: e.exerciseType,
    movement_pattern: e.movementPattern,
    difficulty: e.difficulty,
    ...(e.isCustom ? { is_custom: true } : {}),
    ...(e.excludeFromVolume ? { excluded_from_volume: true } : {}),
  }));
}

// Empty "nothing happened" snapshot per tool, used when a proposal is rejected
// before we know anything about its arguments.
function emptySnapshotFor(name: ToolCall['name']): ProposalSnapshot {
  switch (name) {
    case 'create_template':
    case 'edit_template':
    case 'add_exercises_to_template':
    case 'delete_template':
      return { kind: 'template', template: null };
    case 'create_program':
    case 'delete_program':
      return { kind: 'program', program: null };
    case 'set_active_program':
      return { kind: 'active-program', programId: null, programName: null };
    default:
      return { kind: 'session', rows: [] };
  }
}

/* ===== The workout with no screen on it ==================================
 *
 * `ActiveSession` registers a session controller while it is mounted and drops
 * it on unmount — and minimizing a workout unmounts it. The workout itself is
 * not gone: it lives on in the session cache, which is what the "Workout in
 * progress" bar shows and what Resume rebuilds the screen from. Serving the
 * coach from the registered controller alone is what made it answer "no active
 * workout" to a user looking straight at that bar, and turned a suggestion made
 * a moment earlier into a card that could never be applied.
 *
 * So the coach reads whichever of the two IS the workout right now, and there
 * is exactly one writer of the cache at any moment:
 *
 *   screen mounted   -> the screen owns the workout. Its own debounced write is
 *                       the only thing that touches the cache; the coach goes
 *                       through the registered controller, and
 *                       `cachedSessionController` returns null so it cannot
 *                       write behind the screen's back (a write there would be
 *                       overwritten by the next flush half a second later).
 *   screen unmounted -> the cache IS the workout, and the coach writes it.
 *                       The screen reads it back when it mounts again, which is
 *                       how a change made while minimized is on screen after
 *                       Resume.
 *
 * Editing a PAST workout stays invisible either way: the edit screen registers
 * no controller and writes no cache, so the coach sees the minimized live
 * workout if there is one and no workout at all otherwise.
 */

export const WORKOUT_CHANGED_MESSAGE =
  'That workout is no longer the one in progress — ask the coach again.';

function readSessionCache(): ActiveSessionCache | null {
  try {
    const raw = localStorage.getItem(ACTIVE_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveSessionCache | null;
    return parsed && Array.isArray(parsed.blocks) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSessionCache(cache: ActiveSessionCache): boolean {
  try {
    localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch (e) {
    console.warn('[chat] Failed to write session cache:', e);
    return false;
  }
}

/**
 * Which workout a cache holds: the template it was started from and the moment
 * it began. Both are fixed for the life of one workout — the timer's anchor is
 * not, it shifts forward on every resume — so this survives a minimize, a
 * resume and a pause, and changes the instant a different workout is started.
 * A session proposal records it and refuses to apply against anything else,
 * which is the same rule `ActiveSession` applies when it refuses a cache whose
 * templateId is not its own.
 */
function sessionWorkoutKey(cache: ActiveSessionCache | null): string | null {
  if (!cache) return null;
  return `${cache.templateId ?? ''}@${cache.trueStartTimestamp ?? cache.startTimestamp ?? ''}`;
}

function currentWorkoutKey(): string | null {
  return sessionWorkoutKey(readSessionCache());
}

interface CachedSessionOptions {
  nameFor: (exerciseId: string) => string;
  defaultRestSeconds: number;
  defaultDropSetsEnabled: boolean;
}

/**
 * The same four mutations `ActiveSession` registers, applied to the cache
 * instead of to React state, for a workout whose screen is not mounted.
 * Returns null when a screen is mounted (it owns the workout) or when there is
 * no workout in progress at all.
 */
function cachedSessionController(opts: CachedSessionOptions): SessionMutations | null {
  if (isSessionActive()) return null;
  const opened = readSessionCache();
  if (!opened) return null;
  const key = sessionWorkoutKey(opened);

  // Re-read on every call rather than closing over `opened`: the workout can
  // be discarded, or replaced by another one, between the proposal and the tap.
  const read = (): ActiveSessionCache | null => {
    const cache = readSessionCache();
    return cache && sessionWorkoutKey(cache) === key ? cache : null;
  };

  // None of the four mutations below moves or removes a row — they append a
  // block, append sets, or rewrite a row in place — so the rest timer, the rest
  // records and the running set held in the same cache stay pointed at the rows
  // they were on. One that did move rows would have to remap those the way
  // `useBlockMutations` does on screen.
  const mutate = (fn: (blocks: SessionBlock[]) => SessionBlock[] | null): boolean => {
    const cache = read();
    if (!cache) return false;
    // A screen that mounted in between owns the workout now; its next flush
    // would overwrite whatever we wrote here.
    if (isSessionActive()) return false;
    const blocks = fn(cache.blocks);
    if (!blocks) return false;
    return writeSessionCache({ ...cache, blocks });
  };

  const setRow = (over: Partial<SessionSetRow> & { setNumber: number }): SessionSetRow => ({
    weight: '', reps: '', completed: false, type: 'normal', rpe: '', time: '', ...over,
  });

  return {
    addExercise: (exerciseId, sets = 3, targetReps, weight) => mutate(blocks => {
      if (blocks.some(b => b.exerciseId === exerciseId)) return null;
      return [...blocks, {
        exerciseId,
        exerciseName: opts.nameFor(exerciseId),
        restSeconds: opts.defaultRestSeconds,
        dropSetsEnabled: opts.defaultDropSetsEnabled,
        sets: Array.from({ length: sets }, (_, i) => setRow({
          setNumber: i + 1,
          weight: weight?.toString() ?? '',
          reps: targetReps?.toString() ?? '',
        })),
      }];
    }),
    addSets: (identifier, count) => mutate(blocks => {
      let found = false;
      const next = blocks.map((block, idx) => {
        const match = block.exerciseName.toLowerCase() === identifier.toLowerCase()
          || idx.toString() === identifier;
        if (!match) return block;
        found = true;
        const lastSet = block.sets[block.sets.length - 1];
        const normalCount = block.sets.filter(s => s.type !== 'warmup').length;
        const newSets = Array.from({ length: count }, (_, i) => setRow({
          setNumber: normalCount + i + 1,
          weight: lastSet?.weight ?? '',
          reps: lastSet?.reps ?? '',
          type: lastSet?.type === 'warmup' ? 'normal' : lastSet?.type ?? 'normal',
        }));
        return { ...block, sets: [...block.sets, ...newSets] };
      });
      return found ? next : null;
    }),
    updateSet: (exerciseName, setNumber, updates) => mutate(blocks => {
      let found = false;
      const next = blocks.map(block => {
        if (block.exerciseName.toLowerCase() !== exerciseName.toLowerCase()) return block;
        return {
          ...block,
          sets: block.sets.map(set => {
            // Warm-ups carry their own 1..n numbering; "set 1" is working set 1,
            // exactly as the mounted screen reads it.
            if (set.type === 'warmup' || set.setNumber !== setNumber) return set;
            found = true;
            return {
              ...set,
              ...(updates.weight !== undefined ? { weight: updates.weight.toString() } : {}),
              ...(updates.reps !== undefined ? { reps: updates.reps.toString() } : {}),
            };
          }),
        };
      });
      return found ? next : null;
    }),
    swapExercise: (currentName, newExerciseId) => mutate(blocks => {
      let found = false;
      const next = blocks.map(block => {
        if (block.exerciseName.toLowerCase() !== currentName.toLowerCase()) return block;
        found = true;
        return { ...block, exerciseId: newExerciseId, exerciseName: opts.nameFor(newExerciseId) };
      });
      return found ? next : null;
    }),
    getBlocks: () => read()?.blocks ?? [],
    getStartTime: () => {
      // A hand-edited or half-written cache must not reach `new Date(...)` as
      // undefined: that throws, and it would take the whole turn down with it.
      const started = read()?.startTimestamp ?? opened.startTimestamp;
      return typeof started === 'number' && Number.isFinite(started) ? started : Date.now();
    },
    getActiveRestTimer: () => {
      const timer = read()?.activeTimer;
      if (!timer) return null;
      const raw = timer.status === 'paused'
        ? timer.elapsedAtPause ?? 0
        : timer.status === 'running'
          ? Math.floor((Date.now() - timer.startedAtEpoch) / 1000)
          : timer.originalDuration;
      const elapsed = Math.min(Math.max(0, raw), timer.originalDuration);
      return {
        status: timer.status,
        exerciseIndex: timer.id.blockIdx,
        setIndex: timer.id.setIdx,
        durationSeconds: timer.duration,
        originalDurationSeconds: timer.originalDuration,
        elapsedSeconds: elapsed,
        remainingSeconds: Math.max(0, timer.originalDuration - elapsed),
      };
    },
  };
}

// Turn the raw streamed accumulators into tool calls, separating out the ones
// whose arguments never finished arriving. Unparseable JSON means the
// tool_use block was cut off mid-write (the response hit max_tokens); running
// those through normal validation reports whichever required field happens to
// be missing ("Template requires a name and at least one exercise"), which
// points the user at the wrong problem entirely.
// Exported for unit testing — pure, no React/singleton deps.
export function parseAccumulatedToolCalls(
  raw: readonly (RawToolCallAccumulator | undefined)[],
): { toolCalls: ToolCall[]; cutOffIds: Set<string> } {
  const cutOffIds = new Set<string>();
  const toolCalls = raw
    .filter((tc): tc is RawToolCallAccumulator => Boolean(tc?.name) && AI_ALLOWED_ACTIONS.has(tc.name))
    .map(tc => {
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(tc.arguments);
      } catch {
        cutOffIds.add(tc.id);
        parsedArgs = {};
      }
      return { id: tc.id, name: tc.name, arguments: parsedArgs, status: 'pending' as const } as ToolCall;
    });
  return { toolCalls, cutOffIds };
}

// Allowed AI actions — anything not here is blocked
const AI_ALLOWED_ACTIONS = new Set([
  'create_template', 'edit_template', 'add_exercises_to_template', 'delete_template',
  'create_program', 'delete_program', 'set_active_program',
  'get_workout_history',
  'add_exercise_to_workout', 'add_sets_to_exercise',
  'update_set_weight_reps', 'swap_exercise_in_workout',
]);

// Strict ID-only validation. The fuzzy match is kept ONLY as a suggestion
// payload so Claude can self-correct on the next turn — it never resolves.
function fuzzySuggestions(needle: string, list: ExerciseLike[]): string[] {
  const term = needle.toLowerCase();
  if (!term) return [];
  return list
    .filter(e => e.name.toLowerCase().includes(term) || term.includes(e.name.toLowerCase()))
    .slice(0, 5)
    .map(e => e.name);
}

function validateExerciseReference(
  exerciseId: string,
  exerciseName: string | undefined,
  byId: Map<string, ExerciseLike>,
  list: ExerciseLike[],
): { valid: boolean; error?: string; suggestions?: string[] } {
  if (exerciseId && byId.has(exerciseId)) return { valid: true };
  const suggestions = fuzzySuggestions(exerciseName || exerciseId || '', list);
  return {
    valid: false,
    suggestions,
    error: `Missing or unknown exerciseId "${exerciseId || ''}". Use an id from available_exercises.${suggestions.length ? ' Did you mean: ' + suggestions.join(', ') + '?' : ''}`,
  };
}

// Pick the exercises an add_exercises_to_template call actually contributes.
// The tool contract is "send only the new ones", but a model that re-sends the
// whole list (or names one twice) would otherwise duplicate rows the template
// already has. Order of the additions is preserved.
// Exported for unit testing — pure, no React/singleton deps.
export function appendableTemplateExercises<T extends { exerciseId: string }>(
  existing: readonly { exerciseId: string }[],
  incoming: readonly T[],
): { additions: T[]; skipped: number } {
  const seen = new Set(existing.map(e => e.exerciseId));
  const additions: T[] = [];
  for (const e of incoming) {
    if (seen.has(e.exerciseId)) continue;
    seen.add(e.exerciseId);
    additions.push(e);
  }
  return { additions, skipped: incoming.length - additions.length };
}

// The AI sometimes emits the same add_exercise_to_workout call more than once
// in one response. proposeToolCall is a pure projection (never mutates the
// session), so each repeat would otherwise become its own pending tile.
// Exported for unit testing — pure, no React/singleton deps.
export function isDuplicateSessionAdd(
  proposal: Pick<Proposal, 'toolName' | 'arguments' | 'status'>,
  coveredExerciseIds: ReadonlySet<string>,
): boolean {
  if (proposal.toolName !== 'add_exercise_to_workout') return false;
  if (proposal.status !== 'pending') return false;
  const exId = proposal.arguments?.exerciseId;
  return typeof exId === 'string' && coveredExerciseIds.has(exId);
}

/**
 * Carry template-only data across a wholesale `edit_template`.
 *
 * The tool replaces the exercise list outright, and an exercise the model
 * re-sends unchanged comes back holding only the fields the schema describes.
 * Anything else the template row held — its superset link, its target load,
 * its target RPE — has to be taken back off the row being replaced, or every
 * superset in the template is silently unlinked by an edit that never meant to
 * touch it. A value the model did send always wins.
 */
export function carryTemplateOnlyFields(
  incoming: ExerciseInput[],
  existing: ExerciseInput[] | undefined,
): ExerciseInput[] {
  const before = new Map((existing ?? []).map(e => [e.exerciseId, e] as const));
  return incoming.map(e => {
    const prior = before.get(e.exerciseId);
    if (!prior) return e;
    return {
      ...e,
      targetRpe: e.targetRpe ?? prior.targetRpe,
      supersetGroup: e.supersetGroup ?? prior.supersetGroup,
      targetWeight: e.targetWeight ?? prior.targetWeight,
      targetDistance: e.targetDistance ?? prior.targetDistance,
    };
  });
}

const SET_TYPES: ReadonlySet<string> = new Set<SetType>(['normal', 'superset', 'dropset', 'failure', 'warmup']);

// The tool schema lists the set types, but the model is not held to the enum
// and edit_template's schema has none. Anything outside SetType used to be
// saved as-is and crashed the session summary (SET_TYPE_CONFIG[type] is
// undefined). Exported for unit testing.
export function normalizeSetType(value: unknown): SetType {
  return typeof value === 'string' && SET_TYPES.has(value) ? (value as SetType) : 'normal';
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isLoad = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
// An upper bound so a km-as-metres slip (a "5000 km" run) is refused rather than saved.
const MAX_TARGET_DISTANCE_M = 1_000_000;
const isDistance = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_TARGET_DISTANCE_M;

export const NUMERIC_BOUNDS = {
  sets: [1, 20],
  count: [1, 20],
  reps: [1, 1000],
  restSeconds: [0, 3600],
} as const;

/**
 * Bounds on the numbers a tool call may carry. `sets` and `count` become
 * array lengths (0 or negative throws, a huge one freezes the app), a missing
 * targetReps crashes templateToBlocks when the workout starts, and the rest
 * are persisted verbatim. Each problem is reported as a sentence the model
 * can act on next turn. Exported for unit testing.
 */
export function templateExerciseIssues(e: ExerciseInput, name: string): string[] {
  const issues: string[] = [];
  const [minSets, maxSets] = NUMERIC_BOUNDS.sets;
  if (!isInt(e.sets, minSets, maxSets)) {
    issues.push(`${name}: sets must be a whole number from ${minSets} to ${maxSets} (got ${JSON.stringify(e.sets)}).`);
  }
  const [minReps, maxReps] = NUMERIC_BOUNDS.reps;
  if (e.targetReps !== 'failure' && !isInt(e.targetReps, minReps, maxReps)) {
    issues.push(`${name}: targetReps must be a whole number from ${minReps} to ${maxReps} (got ${JSON.stringify(e.targetReps)}).`);
  }
  const [minRest, maxRest] = NUMERIC_BOUNDS.restSeconds;
  // `!= null`: the model sometimes nulls an optional field rather than
  // omitting it, and a null defaults downstream exactly as an omission does.
  if (e.restSeconds != null && !isInt(e.restSeconds, minRest, maxRest)) {
    issues.push(`${name}: restSeconds must be a whole number from ${minRest} to ${maxRest} (got ${JSON.stringify(e.restSeconds)}).`);
  }
  if (e.targetWeight != null && !isLoad(e.targetWeight)) {
    issues.push(`${name}: targetWeight must be a number of 0 or more (got ${JSON.stringify(e.targetWeight)}).`);
  }
  if (e.targetDistance != null && !isDistance(e.targetDistance)) {
    issues.push(`${name}: targetDistance must be a number of metres above 0 and at most ${MAX_TARGET_DISTANCE_M} (got ${JSON.stringify(e.targetDistance)}).`);
  }
  return issues;
}

/** The same bounds for the live-session tools; every field is optional there. */
export function sessionArgIssues(args: { sets?: unknown; count?: unknown; targetReps?: unknown; reps?: unknown; weight?: unknown }): string[] {
  const issues: string[] = [];
  const check = (key: 'sets' | 'count', value: unknown) => {
    const [min, max] = NUMERIC_BOUNDS[key];
    if (value !== undefined && !isInt(value, min, max)) issues.push(`${key} must be a whole number from ${min} to ${max} (got ${JSON.stringify(value)}).`);
  };
  check('sets', args.sets);
  check('count', args.count);
  const [minReps, maxReps] = NUMERIC_BOUNDS.reps;
  for (const key of ['targetReps', 'reps'] as const) {
    const value = args[key];
    if (value !== undefined && !isInt(value, minReps, maxReps)) issues.push(`${key} must be a whole number from ${minReps} to ${maxReps} (got ${JSON.stringify(value)}).`);
  }
  if (args.weight !== undefined && !isLoad(args.weight)) issues.push(`weight must be a number of 0 or more (got ${JSON.stringify(args.weight)}).`);
  return issues;
}

/**
 * Give appended exercises superset ids the template is not already using.
 * The model numbers groups from 1 within the list it sends, so a new pair
 * arriving as group 1 fused with the template's existing group 1 into a
 * four-exercise superset. A colliding id shared by two or more additions is
 * their own superset and gets a fresh id; a single addition carrying an
 * existing id is joining that superset and keeps it. Exported for unit
 * testing.
 */
export function remapSupersetGroups<T extends { supersetGroup?: number }>(
  existing: readonly { supersetGroup?: number }[],
  additions: readonly T[],
): T[] {
  const taken = new Set<number>();
  for (const e of existing) if (typeof e.supersetGroup === 'number') taken.add(e.supersetGroup);
  const incomingCounts = new Map<number, number>();
  for (const e of additions) {
    if (typeof e.supersetGroup === 'number') incomingCounts.set(e.supersetGroup, (incomingCounts.get(e.supersetGroup) ?? 0) + 1);
  }
  // Above every id in play, the template's and the additions' alike: a fresh
  // id equal to a non-colliding incoming pair's would fuse the two.
  let next = Math.max(0, ...taken, ...incomingCounts.keys()) + 1;
  const fresh = new Map<number, number>();
  return additions.map(e => {
    const g = e.supersetGroup;
    if (typeof g !== 'number' || !taken.has(g) || (incomingCounts.get(g) ?? 0) < 2) return e;
    if (!fresh.has(g)) fresh.set(g, next++);
    return { ...e, supersetGroup: fresh.get(g) };
  });
}

const sameValue = (a: unknown, b: unknown) => (a ?? undefined) === (b ?? undefined);

/**
 * Whether a template still holds what a proposal was built against. Compared
 * by content, not identity: a reload hands back fresh objects for unchanged
 * rows, and a proposal must not be refused for that. Exported for unit
 * testing.
 */
export function templateChangedSince(
  before: { name: string; exercises: ExerciseInput[] },
  current: { name: string; exercises: ExerciseInput[] } | undefined,
): boolean {
  if (!current) return true;
  if (before.name !== current.name) return true;
  const a = before.exercises ?? [];
  const b = current.exercises ?? [];
  if (a.length !== b.length) return true;
  const fields = ['exerciseId', 'sets', 'targetReps', 'setType', 'restSeconds', 'targetWeight', 'targetDistance', 'targetRpe', 'supersetGroup'] as const;
  return a.some((x, i) => fields.some(f => !sameValue(x[f], b[i][f])));
}

export const TEMPLATE_CHANGED_MESSAGE = 'Template changed since this was proposed — ask the coach again.';

interface DeleteBlockerSource {
  programs?: { id: string; name: string; days: { templateId: string }[] }[];
  futureWorkouts?: { templateId: string; programId: string; date: string; completed?: boolean }[];
  dataTrusted?: boolean;
}

/**
 * The same rule the Templates screen applies (`templateUsedBy` in Index.tsx):
 * a template a program schedules, or a manual scheduled workout points at,
 * cannot be deleted. Before this the coach deleted it with no check and the
 * program's days for it vanished from the calendar. Exported for unit testing.
 */
export function templateDeleteBlockers(templateId: string, storage: DeleteBlockerSource): string[] {
  if (!storage.dataTrusted) return ['data that is still loading'];
  const programs = (storage.programs ?? []).filter(p => p.days.some(d => d.templateId === templateId));
  const names = programs.map(p => p.name);
  const today = formatLocalDate();
  const listed = new Set(programs.map(p => p.id));
  const scheduled = (storage.futureWorkouts ?? []).filter(fw =>
    fw.templateId === templateId && !fw.completed && fw.date >= today && !listed.has(fw.programId)).length;
  if (scheduled > 0) names.push(`${scheduled} scheduled workout${scheduled === 1 ? '' : 's'}`);
  return names;
}

const deleteBlockedMessage = (name: string, blockers: string[]) =>
  `"${name}" is used by ${blockers.map(b => `"${b}"`).join(', ')}. Remove it from ${blockers.length === 1 ? 'that program' : 'those programs'} first.`;

/**
 * Template ids a create_program call names that the user does not have. A
 * program saved with one schedules calendar rows that point at nothing.
 * Exported for unit testing.
 */
export function unknownProgramTemplates(days: readonly unknown[], knownIds: ReadonlySet<string>): string[] {
  const missing = new Set<string>();
  for (const day of days) {
    const templateId = day && typeof day === 'object' ? (day as { templateId?: unknown }).templateId : undefined;
    if (typeof templateId !== 'string' || templateId === '') { missing.add(String(templateId)); continue; }
    if (templateId !== 'rest' && !knownIds.has(templateId)) missing.add(templateId);
  }
  return Array.from(missing);
}

const unknownTemplatesMessage = (missing: string[]) =>
  `Unknown template id${missing.length === 1 ? '' : 's'}: ${missing.map(m => `"${m}"`).join(', ')}. Every day needs an id from user_templates, or "rest".`;

function validateAllExercises(
  exercises: ExerciseInput[],
  byId: Map<string, ExerciseLike>,
  list: ExerciseLike[],
): { valid: boolean; validated: ExerciseInput[]; errors: string[]; suggestions: string[] } {
  const errors: string[] = [];
  const allSuggestions: string[] = [];
  const validated: ExerciseInput[] = [];
  for (const e of exercises) {
    const result = validateExerciseReference(e.exerciseId, e.exerciseName, byId, list);
    if (!result.valid) {
      errors.push(result.error!);
      if (result.suggestions) allSuggestions.push(...result.suggestions);
      continue;
    }
    const numeric = templateExerciseIssues(e, byId.get(e.exerciseId)?.name ?? e.exerciseId);
    if (numeric.length) {
      errors.push(...numeric);
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
  profile: ["Suggest a program for my goal", "What exercises can I do with my equipment?", "Am I on track for my goal?"],
};

const DEFAULT_CHIPS = ["Build me a program", "Create a template", "What should I train today?"];

// The operator metering bypass is decided entirely server-side, from the
// METERING_BYPASS_USER_IDS function secret (see CLAUDE.md). The client no longer
// tracks it at all: it cannot know whether the server granted the ask, and a
// client that assumed it had been granted showed a stale balance, hid the
// out-of-credits banner and turned the server's 402 into a bogus five-minute
// "AI is temporarily unavailable" lockout for anyone who typed the phrase.
// The phrase is now sent as an ordinary message; ai-coach recognises it only
// for an allowlisted user id. Credits are displayed normally either way — for
// an allowlisted operator the balance simply stops going down.
export const COOLDOWN_MS = 2000;
const MESSAGE_WINDOW = 10;
export const DISABLE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
// A turn with no chunk for this long is abandoned. Without it a connection
// that stalls (captive portal, sleeping phone, proxy that swallows the tail)
// left the coach in isLoading until a reload.
export const STREAM_INACTIVITY_MS = 60 * 1000;
export const STALLED_STREAM_MESSAGE = "The coach stopped responding — try again.";
export const LOCKED_OUT_MESSAGE = "AI is temporarily unavailable. You can still build templates manually. Will retry in 5 minutes.";

// What a tool call cut off mid-write is reported as, on the card and in the
// reply alike, so the two say the same thing.
export const TRUNCATED_PROPOSAL_MESSAGE = "That was too big to fit in one reply, so the proposal got cut off. Ask for it in smaller pieces and I'll build it up.";
export const INCOMPLETE_PROPOSAL_MESSAGE = 'The proposal came back incomplete. Try asking again.';

// How many assistant rounds one user message may take: the first reply plus
// two more. More than one round is what lets the coach look something up and
// then act on what it found — the round answering the tool results can itself
// call tools. Every round is a separate metered call the user pays for, so the
// number is a hard cap rather than "until the model stops"; reaching it ends
// the turn normally, with whatever was proposed already on screen.
export const MAX_ASSISTANT_ROUNDS = 3;

// The rounds of one turn share a bubble, and their prose reads as one reply.
const joinRounds = (before: string, next: string) => [before, next].filter(Boolean).join('\n\n');

// Sentinel thrown when the server reports balance_exhausted (HTTP 402). Caught
// separately from real transport/AI errors — running out of credits is an
// expected end state, not a fault, so it must NOT increment the consecutive
// error counter that trips a 5-minute chat lockout.
class BalanceExhaustedError extends Error {
  constructor() {
    super('AI credits exhausted');
    this.name = 'BalanceExhaustedError';
  }
}

// Fallback narration when the follow-up turn produces no prose of its own.
function toolCallSummary(toolCalls: readonly ToolCall[]): string {
  return toolCalls.map(tc => tc.result?.message || `${tc.name} completed`).join('. ');
}

// Thrown when the edge function reports that the stream died after it had
// already started (upstream billing, rate limit, or a dropped connection). It
// carries the server's plain-language reason so the chat can show that instead
// of the empty reply the client used to render when it skipped the payload.
class StreamFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StreamFailedError';
  }
}

// HTTP 413 from ai-coach: the request itself is over the function's size
// limits, and the body carries the server's sentence saying which. Retrying
// the same request can only get the same answer, and it is the message that
// is at fault rather than the service, so it never counts toward the lockout.
class RequestTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestTooLargeError';
  }
}

// Rejects when the signal aborts, so a read on a body that does not honour
// the abort itself (or a fetch that never hands one back) still unblocks.
function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new DOMException('The turn was aborted.', 'AbortError'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

export const ChatProvider: React.FC<{
  children: React.ReactNode;
  // storage is useStorage()'s return value. Typing this as
  // ReturnType<typeof useStorage> exposes latent shape mismatches between
  // Proposal.ExerciseInput/ProgramDayInput (narrow, tool-side) and
  // WorkoutTemplate/WorkoutProgram (wide, storage-side) — resolving them
  // is a real refactor, not a lint pass, so we keep `any` here with an
  // explicit disable so it's flagged rather than hidden.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storage: any;
}> = ({ children, storage }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const screenRef = useRef<ScreenContext>({ screen: 'dashboard' });
  const [currentScreen, setCurrentScreen] = useState('dashboard');
  const [creditsBalance, setCreditsBalance] = useState<CreditsBalance>(EMPTY_BALANCE);
  // False until a balance has been read from the server (or the server has
  // told us it is exhausted). While it is false `creditsBalance` is only the
  // placeholder, so a credits display should say it could not load rather than
  // show the allowance as if it were real.
  const [balanceKnown, setBalanceKnown] = useState(false);
  const [consecutiveErrors, setConsecutiveErrors] = useState(0);
  const [cooldownActive, setCooldownActive] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  // The error path of a turn runs long after the render that created it, and
  // a reset that happened inside the same turn (on a good response) is not in
  // its closure. Both counters are read from refs for that reason; the state
  // copies exist only to render.
  const consecutiveErrorsRef = useRef(0);
  const lockedUntilRef = useRef(0);
  const sendDisabledUntil = useRef(0);
  // The turn currently streaming, so clearChat and unmount can end it.
  const turnAbortRef = useRef<AbortController | null>(null);

  const setErrorCount = useCallback((n: number) => {
    consecutiveErrorsRef.current = n;
    setConsecutiveErrors(n);
  }, []);

  const lockOut = useCallback((until: number) => {
    lockedUntilRef.current = until;
    setLockedUntil(until);
  }, []);

  const releaseLockout = useCallback(() => {
    lockedUntilRef.current = 0;
    setLockedUntil(0);
    consecutiveErrorsRef.current = 0;
    setConsecutiveErrors(0);
  }, []);

  // Honours the "will retry in 5 minutes" promise: before this the count was
  // only reset by a successful turn, which the lockout itself prevented.
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = setTimeout(releaseLockout, Math.max(0, lockedUntil - Date.now()));
    // A background tab's timers are throttled or frozen; on return an overdue
    // lockout lifts at once rather than sitting at "Back in 0:00".
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= lockedUntil) releaseLockout();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [lockedUntil, releaseLockout]);

  useEffect(() => () => {
    turnAbortRef.current?.abort();
  }, []);
  const balanceResyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [proposalIdsByMessage, setProposalIdsByMessage] = useState<Record<string, string[]>>({});
  const [memberSince, setMemberSince] = useState<string | null>(null);

  // Subscription tier only affects the size of the monthly metered allowance
  // (premium gets a larger bucket); it is no longer a gate bypass. Tracked via
  // a ref so the []-dep refreshBalance callback always reads the current value.
  const tierRef = useRef<string | null | undefined>(undefined);
  tierRef.current = storage?.profile?.subscriptionTier;

  // Merge the user's custom exercises into the resolver so the AI can reference
  // them in tools (view + swap), even though it cannot create new ones.
  const { exercises: customExercises } = useCustomExercisesContext();
  const mergedExercises = useMemo<ExerciseLike[]>(
    () => [...EXERCISE_DATABASE, ...customExercises.map(e => ({ ...e, isCustom: true as const }))],
    [customExercises]
  );
  const exerciseById = useMemo(() => new Map(mergedExercises.map(e => [e.id, e])), [mergedExercises]);
  const volumeExcluded = useMemo(() => volumeExcludedIds(customExercises), [customExercises]);
  const exerciseListLean = useMemo(() => buildExerciseListLean(mergedExercises), [mergedExercises]);

  const registerScreen = useCallback((ctx: ScreenContext) => {
    screenRef.current = ctx;
    setCurrentScreen(ctx.screen);
  }, []);

  const quickChips = SCREEN_CHIPS[currentScreen] || DEFAULT_CHIPS;

  // postgrest-js resolves { data: null, error } rather than throwing — for a
  // 5xx, an expired token and an offline fetch alike — and deriveBalance(null)
  // is a brand-new user on a full monthly allowance. Reading only `data` meant
  // a failed read painted a full bar over a balance already known to be
  // exhausted and re-enabled Send, for the server to refuse with a 402. A
  // failed read now changes nothing: the last known balance stands, and if
  // none was ever read the balance stays unknown rather than full.
  const refreshBalance = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from('user_token_balance')
      .select('paid_balance_micros, free_used_micros, free_period')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) {
      console.error('Balance read failed:', error);
      return;
    }
    setCreditsBalance(deriveBalance(data ?? null, tierRef.current));
    setBalanceKnown(true);
  }, []);

  // The edge function meters credits in a background EdgeRuntime.waitUntil task
  // that commits AFTER the response stream closes, so an immediate refresh
  // races (and loses to) the server deduction. Refresh now for snappy feedback,
  // then again shortly after to pick up the just-committed cost.
  const resyncBalanceSoon = useCallback(() => {
    if (balanceResyncTimer.current) clearTimeout(balanceResyncTimer.current);
    void refreshBalance();
    balanceResyncTimer.current = setTimeout(() => {
      balanceResyncTimer.current = null;
      void refreshBalance();
    }, 2000);
  }, [refreshBalance]);

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.created_at) setMemberSince(user.created_at.substring(0, 10));
    };
    init();
  }, []);

  // The allowance is sized by tier, and on a cold open the profile lands after
  // the first fetch, so the balance is re-read whenever the tier changes (that
  // covers mount too). Before this a premium user saw the free allowance until
  // their next message resynced it.
  const subscriptionTier = storage?.profile?.subscriptionTier;
  useEffect(() => {
    void refreshBalance();
  }, [subscriptionTier, refreshBalance]);

  const daysSinceMember = useCallback((): number | null => {
    if (!memberSince) return null;
    const start = new Date(memberSince + 'T00:00:00');
    const ms = Date.now() - start.getTime();
    return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
  }, [memberSince]);

  const earliestSessionDate = useMemo<string | null>(() => {
    const dates = (storage.history ?? []).map(s => s.date).filter(Boolean);
    return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  }, [storage.history]);

  /**
   * The workout in progress, from whichever of the two holds it: the mounted
   * screen's controller, or the session cache while the workout is minimized.
   * Null when there is no workout at all — which is also what a past workout
   * being edited looks like, since the edit screen registers nothing.
   */
  const sessionController = useCallback((): SessionMutations | null => (
    getSessionController() ?? cachedSessionController({
      nameFor: (exerciseId: string) => exerciseById.get(exerciseId)?.name ?? exerciseId,
      defaultRestSeconds: storage.preferences?.defaultRestSeconds ?? 90,
      defaultDropSetsEnabled: storage.preferences?.defaultDropSetsEnabled ?? false,
    })
  ), [exerciseById, storage.preferences?.defaultRestSeconds, storage.preferences?.defaultDropSetsEnabled]);

  const buildContext = useCallback(() => {
    const memberDays = daysSinceMember();
    const historyMax = historyHorizonDays(memberSince, earliestSessionDate);

    const measurements: { id: string; date: string; weightKg: number }[] = storage.bodyMeasurements ?? [];
    const latestBw = measurements[0];

    // Serialized as JSON into the AI's system prompt. The concrete keys depend
    // on user state (only include user_templates when non-empty, etc.) so the
    // record is dynamic — `unknown` values are fine here.
    const ctx: Record<string, unknown> = {
      current_screen: screenRef.current.screen,
      current_data: screenRef.current.data || {},
      available_exercises: exerciseListLean,
      user_profile: {
        display_name: storage.profile?.displayName ?? null,
        weight_unit: storage.preferences?.weightUnit ?? 'lbs',
        member_since: memberSince,
        days_since_member: memberDays,
        earliest_logged_workout: earliestSessionDate,
        history_window_max_days: historyMax,
        total_sessions_logged: storage.history?.length ?? 0,
        goal: storage.profile?.goal ?? null,
        hybrid_goals: storage.profile?.goal === 'hybrid' ? (storage.profile?.hybridGoals ?? []) : [],
        coach_notes: storage.profile?.coachNotes ?? null,
        experience_level: storage.profile?.experienceLevel ?? null,
        equipment: storage.profile?.equipment ?? [],
        injuries: storage.profile?.injuries ?? [],
        age: storage.profile?.age ?? null,
        sex: storage.profile?.sex ?? null,
        height_cm: storage.profile?.heightCm ?? null,
        current_bodyweight_kg: latestBw?.weightKg ?? null,
        bodyweight_recent: measurements.slice(0, 5).map(m => ({ date: m.date, weight_kg: m.weightKg })),
      },
    };

    if (storage.templates?.length > 0) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      ctx.user_templates = storage.templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        exercises: (t.exercises ?? []).map((e: any) => ({
          exerciseId: e.exerciseId,
          exerciseName: exerciseById.get(e.exerciseId)?.name || e.exerciseId,
          sets: e.sets,
          targetReps: e.targetReps,
          setType: e.setType,
          restSeconds: e.restSeconds,
          ...(e.targetRpe != null ? { targetRpe: e.targetRpe } : {}),
          ...(e.supersetGroup != null ? { supersetGroup: e.supersetGroup } : {}),
        })),
      }));
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    if (storage.programs?.length > 0) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      ctx.user_programs = storage.programs.map((p: any) => ({
        id: p.id,
        name: p.name,
        ...(p.durationWeeks != null ? { durationWeeks: p.durationWeeks } : {}),
        ...(p.startDate ? { startDate: p.startDate } : {}),
        days: (p.days ?? []).map((d: any) => ({
          label: d.label,
          templateId: d.templateId,
          ...(d.frequency ? { frequency: d.frequency } : {}),
        })),
      }));
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }
    if (storage.activeProgramId) {
      ctx.active_program_id = storage.activeProgramId;
    }

    // The workout in progress — from its screen while that is mounted, from
    // the session cache while it is minimized. Same workout either way;
    // `minimized` is the only difference the coach is told about, so it does
    // not talk as though the user were looking at the sets.
    const session = sessionController();
    if (session) {
      const blocks = session.getBlocks();
      const startTime = session.getStartTime();
      ctx.active_session = {
        minimized: !isSessionActive(),
        started_at: new Date(startTime).toISOString(),
        elapsed_seconds: Math.max(0, Math.floor((Date.now() - startTime) / 1000)),
        active_rest_timer: session.getActiveRestTimer(),
        exercises: blocks.map((b, i) => {
          const completedSets = b.sets.filter(s => s.completed).length;
          return {
            index: i,
            exerciseId: b.exerciseId,
            exerciseName: b.exerciseName,
            rest_seconds: b.restSeconds,
            completed_sets: completedSets,
            total_sets: b.sets.length,
            fully_completed: completedSets > 0 && completedSets === b.sets.length,
            sets: b.sets.map(s => ({
              setNumber: s.setNumber,
              weight: s.weight,
              reps: s.reps,
              completed: s.completed,
              type: s.type,
            })),
          };
        }),
      };
    }

    return ctx;
  }, [storage, memberSince, daysSinceMember, earliestSessionDate, exerciseById, exerciseListLean, sessionController]);

  const getSessionRows = useCallback((): SessionExerciseRow[] => {
    const controller = sessionController();
    if (!controller) return [];
    // Block sets carry weight/reps as strings (they come straight from the
    // DOM input values). SessionExerciseRow.sets is typed as numbers so the
    // AI, diff card, and validation code can treat them uniformly. Parse
    // once here; empty strings drop to undefined rather than NaN.
    const parseNum = (v: string | undefined): number | undefined => {
      if (v == null || v === '') return undefined;
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : undefined;
    };
    return controller.getBlocks().map(b => ({
      exerciseId: b.exerciseId,
      exerciseName: b.exerciseName,
      sets: b.sets.map(s => ({
        setNumber: s.setNumber,
        weight: parseNum(s.weight),
        reps: parseNum(s.reps),
        type: s.type,
        completed: s.completed,
      })),
    }));
  }, [sessionController]);

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
    const templateIds = () => new Set<string>((storage.templates ?? []).map((t: { id: string }) => t.id));

    switch (tc.name) {
      case 'create_template': {
        const args = tc.arguments;
        if (!args.name || !Array.isArray(args.exercises) || args.exercises.length === 0) {
          return mkInvalid({ kind: 'template', template: null }, 'Template requires a name and at least one exercise.');
        }
        const { valid, validated, errors, suggestions } = validateAllExercises(args.exercises, exerciseById, mergedExercises);
        if (!valid) return mkInvalid({ kind: 'template', template: null }, errors.join('\n'), suggestions);
        const newId = crypto.randomUUID();
        const after = {
          id: newId,
          name: args.name,
          exercises: validated.map(e => ({
            exerciseId: e.exerciseId,
            exerciseName: exerciseById.get(e.exerciseId)?.name || e.exerciseId,
            sets: e.sets,
            targetReps: e.targetReps,
            setType: normalizeSetType(e.setType),
            restSeconds: e.restSeconds ?? 90,
            targetRpe: e.targetRpe,
            supersetGroup: e.supersetGroup,
            targetWeight: e.targetWeight,
            targetDistance: e.targetDistance,
          })),
        };
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before: { kind: 'template', template: null },
          after: { kind: 'template', template: after },
          status: 'pending',
          summary: `Create template "${args.name}" with ${validated.length} exercise${validated.length === 1 ? '' : 's'}`,
        };
        // templateId is the id the template WILL have: the proposal carries it
        // through to saveTemplate, so it is the id to reference once the user
        // has applied the card — never before.
        return { result: { success: true, proposalId: tc.id, templateId: newId, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'edit_template': {
        const args = tc.arguments;
        if (!args.templateId) return mkInvalid({ kind: 'template', template: null }, 'Template ID is required.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = storage.templates.find((t: any) => t.id === args.templateId);
        if (!existing) return mkInvalid({ kind: 'template', template: null }, `Template "${args.templateId}" not found.`);
        const before = { kind: 'template' as const, template: { id: existing.id, name: existing.name, exercises: existing.exercises } };
        let exercises = existing.exercises;
        if (args.exercises?.length) {
          const { valid, validated, errors, suggestions } = validateAllExercises(args.exercises, exerciseById, mergedExercises);
          if (!valid) return mkInvalid(before, errors.join('\n'), suggestions);
          exercises = carryTemplateOnlyFields(validated, existing.exercises).map(e => ({
            exerciseId: e.exerciseId,
            exerciseName: exerciseById.get(e.exerciseId)?.name || e.exerciseId,
            sets: e.sets,
            targetReps: e.targetReps,
            setType: normalizeSetType(e.setType),
            restSeconds: e.restSeconds ?? 90,
            targetRpe: e.targetRpe,
            supersetGroup: e.supersetGroup,
            targetWeight: e.targetWeight,
            targetDistance: e.targetDistance,
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

      case 'add_exercises_to_template': {
        const args = tc.arguments;
        if (!args.templateId) return mkInvalid({ kind: 'template', template: null }, 'Template ID is required.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = storage.templates.find((t: any) => t.id === args.templateId);
        if (!existing) return mkInvalid({ kind: 'template', template: null }, `Template "${args.templateId}" not found.`);
        const before = { kind: 'template' as const, template: { id: existing.id, name: existing.name, exercises: existing.exercises } };
        if (!Array.isArray(args.exercises) || args.exercises.length === 0) {
          return mkInvalid(before, 'At least one exercise to add is required.');
        }
        const { valid, validated, errors, suggestions } = validateAllExercises(args.exercises, exerciseById, mergedExercises);
        if (!valid) return mkInvalid(before, errors.join('\n'), suggestions);
        const currentExercises: ExerciseInput[] = existing.exercises ?? [];
        const { additions, skipped } = appendableTemplateExercises(currentExercises, validated);
        if (additions.length === 0) {
          return mkInvalid(before, `Every exercise you listed is already in "${existing.name}".`);
        }
        const appended = remapSupersetGroups(currentExercises, additions).map(e => ({
          exerciseId: e.exerciseId,
          exerciseName: exerciseById.get(e.exerciseId)?.name || e.exerciseId,
          sets: e.sets,
          targetReps: e.targetReps,
          setType: normalizeSetType(e.setType),
          restSeconds: e.restSeconds ?? 90,
          targetRpe: e.targetRpe,
          supersetGroup: e.supersetGroup,
          targetWeight: e.targetWeight,
          targetDistance: e.targetDistance,
        }));
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          before,
          after: { kind: 'template', template: { id: existing.id, name: existing.name, exercises: [...currentExercises, ...appended] } },
          status: 'pending',
          summary: `Add ${appended.length} exercise${appended.length === 1 ? '' : 's'} to "${existing.name}"`,
        };
        return {
          result: {
            success: true,
            proposalId: tc.id,
            message: `Proposal queued: ${proposal.summary}${skipped ? ` (${skipped} already in the template, skipped)` : ''}. Awaiting user apply.`,
          },
          proposal,
        };
      }

      case 'delete_template': {
        const args = tc.arguments;
        if (!args.templateId) return mkInvalid({ kind: 'template', template: null }, 'Template ID is required.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const existing = storage.templates.find((t: any) => t.id === args.templateId);
        if (!existing) return mkInvalid({ kind: 'template', template: null }, `Template "${args.templateId}" not found.`);
        const before = { kind: 'template' as const, template: { id: existing.id, name: existing.name, exercises: existing.exercises } };
        const blockers = templateDeleteBlockers(existing.id, storage);
        if (blockers.length) return mkInvalid(before, deleteBlockedMessage(existing.name, blockers));
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
        const missingTemplates = unknownProgramTemplates(args.days, templateIds());
        if (missingTemplates.length) {
          return mkInvalid({ kind: 'program', program: null }, unknownTemplatesMessage(missingTemplates));
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
        return { result: { success: true, proposalId: tc.id, programId: newId, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'delete_program': {
        const args = tc.arguments;
        if (!args.programId) return mkInvalid({ kind: 'program', program: null }, 'Program ID is required.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const target = storage.programs.find((p: any) => p.id === args.programId);
        if (!target) return mkInvalid({ kind: 'active-program', programId: null, programName: null }, `Program "${args.programId}" not found.`);
        const currentActiveId: string | null = storage.activeProgramId ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        const validation = validateExerciseReference(args.exerciseId, args.exerciseName, exerciseById, mergedExercises);
        if (!validation.valid) return mkInvalid({ kind: 'session', rows: getSessionRows() }, validation.error!, validation.suggestions);
        if (!sessionController()) return mkInvalid({ kind: 'session', rows: [] }, 'No active workout session. Start a workout first.');
        const rows = getSessionRows();
        if (rows.some(r => r.exerciseId === args.exerciseId)) {
          return mkInvalid({ kind: 'session', rows }, 'Exercise is already in the workout.');
        }
        const argIssues = sessionArgIssues(args);
        if (argIssues.length) return mkInvalid({ kind: 'session', rows }, argIssues.join('\n'));
        const exName = exerciseById.get(args.exerciseId)!.name;
        const sets = args.sets ?? 3;
        const newRow: SessionExerciseRow = {
          exerciseId: args.exerciseId,
          exerciseName: exName,
          sets: Array.from({ length: sets }, (_, i) => ({ setNumber: i + 1, weight: args.weight, reps: args.targetReps, type: 'normal', completed: false })),
        };
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          sessionKey: currentWorkoutKey(),
          before: { kind: 'session', rows },
          after: { kind: 'session', rows: [...rows, newRow] },
          status: 'pending',
          summary: `Add ${exName} to your workout`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'add_sets_to_exercise': {
        const args = tc.arguments;
        if (!sessionController()) return mkInvalid({ kind: 'session', rows: [] }, 'No active workout session.');
        const rows = getSessionRows();
        const targetRow = rows.find(r => r.exerciseId === args.exerciseId);
        if (!targetRow) return mkInvalid({ kind: 'session', rows }, `Exercise id "${args.exerciseId}" is not in the current workout.`);
        const argIssues = sessionArgIssues(args);
        if (argIssues.length) return mkInvalid({ kind: 'session', rows }, argIssues.join('\n'));
        const count = args.count ?? 1;
        const lastSetNumber = targetRow.sets.length;
        const newSets = Array.from({ length: count }, (_, i) => ({ setNumber: lastSetNumber + i + 1, type: 'normal' as const, completed: false }));
        const after = rows.map(r => r.exerciseId === args.exerciseId ? { ...r, sets: [...r.sets, ...newSets] } : r);
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          sessionKey: currentWorkoutKey(),
          before: { kind: 'session', rows },
          after: { kind: 'session', rows: after },
          status: 'pending',
          summary: `Add ${count} set${count === 1 ? '' : 's'} to ${targetRow.exerciseName}`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'update_set_weight_reps': {
        const args = tc.arguments;
        if (!sessionController()) return mkInvalid({ kind: 'session', rows: [] }, 'No active workout session.');
        const rows = getSessionRows();
        const targetRow = rows.find(r => r.exerciseId === args.exerciseId);
        if (!targetRow) return mkInvalid({ kind: 'session', rows }, `Exercise id "${args.exerciseId}" is not in the current workout.`);
        // Warm-ups carry their own 1..n numbering; "set 1" is working set 1,
        // and the session applies the same rule.
        const isTarget = (s: { setNumber: number; type?: string }) => s.type !== 'warmup' && s.setNumber === args.setNumber;
        if (!targetRow.sets.some(isTarget)) {
          return mkInvalid({ kind: 'session', rows }, `Set ${args.setNumber} of ${targetRow.exerciseName} does not exist.`);
        }
        const argIssues = sessionArgIssues(args);
        if (argIssues.length) return mkInvalid({ kind: 'session', rows }, argIssues.join('\n'));
        const after = rows.map(r => r.exerciseId === args.exerciseId
          ? { ...r, sets: r.sets.map(s => isTarget(s) ? { ...s, weight: args.weight ?? s.weight, reps: args.reps ?? s.reps } : s) }
          : r);
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          sessionKey: currentWorkoutKey(),
          before: { kind: 'session', rows },
          after: { kind: 'session', rows: after },
          status: 'pending',
          summary: `Update set ${args.setNumber} of ${targetRow.exerciseName}`,
        };
        return { result: { success: true, proposalId: tc.id, message: `Proposal queued: ${proposal.summary}. Awaiting user apply.` }, proposal };
      }

      case 'swap_exercise_in_workout': {
        const args = tc.arguments;
        const newValidation = validateExerciseReference(args.newExerciseId, args.newExerciseName, exerciseById, mergedExercises);
        if (!newValidation.valid) return mkInvalid({ kind: 'session', rows: getSessionRows() }, newValidation.error!, newValidation.suggestions);
        if (!sessionController()) return mkInvalid({ kind: 'session', rows: [] }, 'No active workout session.');
        const rows = getSessionRows();
        const targetRow = rows.find(r => r.exerciseId === args.exerciseId);
        if (!targetRow) return mkInvalid({ kind: 'session', rows }, `Exercise id "${args.exerciseId}" is not in the current workout.`);
        const newName = exerciseById.get(args.newExerciseId)!.name;
        // Two blocks with one exerciseId break the session's keys, drag
        // order and superset links, the same reason add_exercise refuses.
        if (rows.some(r => r.exerciseId === args.newExerciseId)) {
          return mkInvalid({ kind: 'session', rows }, `${newName} is already in the workout.`);
        }
        const after = rows.map(r => r.exerciseId === args.exerciseId
          ? { ...r, exerciseId: args.newExerciseId, exerciseName: newName }
          : r);
        const proposal: Proposal = {
          id: tc.id, messageId, toolName: tc.name, arguments: tc.arguments,
          sessionKey: currentWorkoutKey(),
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
        const ceiling = historyHorizonDays(memberSince, earliestSessionDate);
        const days = Math.max(1, Math.min(requestedDays, ceiling));
        const clamped: 'membership' | 'max' | null =
          days < requestedDays
            ? (ceiling >= 365 ? 'max' : 'membership')
            : null;

        const meta = { period_days: days, requested_days: requestedDays, actual_days: days, clamped_to: clamped };

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffStr = formatLocalDate(cutoff);
        const allHistory: WorkoutSession[] = storage.history;
        const recent = allHistory.filter((s) => s.date >= cutoffStr && !s.isRestDay);

        const needsExercise = (
          args.analysisType === 'exercise_progression' ||
          args.analysisType === 'exercise_rpe' ||
          args.analysisType === 'weekly_volume_by_exercise'
        );
        if (needsExercise) {
          const v = validateExerciseReference(args.exerciseId ?? '', undefined, exerciseById, mergedExercises);
          if (!v.valid) {
            return { result: { ...meta, success: false, message: v.error, suggestions: v.suggestions } };
          }
        }

        switch (args.analysisType) {
          case 'summary': {
            // Same exclusions the analytics screens apply, so the coach and
            // the charts never quote different totals for the same window.
            const counted = recent.map(w => countedSessionTotals(w, volumeExcluded));
            return { result: {
              ...meta,
              total_workouts: recent.length,
              total_volume: counted.reduce((s, t) => s + t.volume, 0),
              total_sets: counted.reduce((s, t) => s + t.sets, 0),
              total_reps: counted.reduce((s, t) => s + t.reps, 0),
              avg_duration_min: recent.length ? Math.round(recent.reduce((s, w) => s + w.duration, 0) / recent.length / 60) : 0,
            }};
          }

          case 'prs': {
            // Grouped by id: the logged name is a snapshot, so a renamed
            // custom exercise used to come back as two entries. The name is
            // resolved through the lookup and the snapshot is only the
            // fallback for an id the library no longer knows.
            const byExercise = new Map<string, { name: string; weight: number; reps: number; rpe?: number }>();
            for (const session of recent) {
              for (const ex of session.exercises) {
                const name = exerciseById.get(ex.exerciseId)?.name || ex.exerciseName || ex.exerciseId;
                for (const set of ex.sets) {
                  if (set.type === 'warmup') continue;
                  const best = byExercise.get(ex.exerciseId);
                  if (!best || (set.weight || 0) > best.weight) {
                    byExercise.set(ex.exerciseId, { name, weight: set.weight || 0, reps: set.reps, ...(set.rpe ? { rpe: set.rpe } : {}) });
                  }
                }
              }
            }
            const prs: NonNullable<ToolCallResult['prs']> = {};
            for (const [exerciseId, { name, ...best }] of byExercise) {
              const key = name in prs ? exerciseId : name;
              prs[key] = { exercise_id: exerciseId, ...best };
            }
            return { result: { ...meta, prs } };
          }

          case 'frequency': {
            // A body part counts once per session, as the Frequency chart
            // counts it; counting every exercise reported several times its number.
            const freq: Record<string, number> = {};
            for (const session of recent) {
              const parts = new Set(session.exercises.map(ex => exerciseById.get(ex.exerciseId)?.primaryBodyPart || 'Other'));
              for (const bp of parts) freq[bp] = (freq[bp] || 0) + 1;
            }
            return { result: { ...meta, frequency: freq } };
          }

          case 'volume_by_muscle': {
            const vol: Record<string, number> = {};
            for (const session of recent) {
              for (const ex of session.exercises) {
                if (volumeExcluded.has(ex.exerciseId)) continue;
                const bp = exerciseById.get(ex.exerciseId)?.primaryBodyPart || 'Other';
                vol[bp] = (vol[bp] || 0) + ex.sets.filter(s => s.type !== 'warmup').length;
              }
            }
            return { result: { ...meta, sets_by_muscle: vol } };
          }

          case 'rpe_trend': {
            const trend = weeklyRpeTrend(allHistory, days);
            return { result: { ...meta, weekly: trend.weekly, overall_avg_rpe: trend.overall_avg_rpe, total_sets: trend.total_sets } };
          }

          case 'exercise_progression': {
            const exName = exerciseById.get(args.exerciseId!)?.name || args.exerciseId!;
            const prog = exerciseProgression(allHistory, args.exerciseId!, exName, days);
            return { result: { ...meta, exercise_id: prog.exercise_id, exercise_name: prog.exercise_name, sessions: prog.sessions } };
          }

          case 'exercise_rpe': {
            const trend = exerciseRpeTrend(allHistory, args.exerciseId!, days);
            return { result: { ...meta, exercise_id: trend.exercise_id, weekly: trend.weekly, overall_avg_rpe: trend.overall_avg_rpe, total_sets: trend.total_sets } };
          }

          case 'weekly_volume_by_exercise': {
            const exName = exerciseById.get(args.exerciseId!)?.name || args.exerciseId!;
            const wv = weeklyVolumeByExercise(allHistory, args.exerciseId!, exName, days);
            return { result: { ...meta, exercise_id: wv.exercise_id, exercise_name: wv.exercise_name, weekly: wv.weekly } };
          }

          case 'consistency': {
            const mode = (storage.preferences?.streakMode as 'daily' | 'weekly') ?? 'daily';
            const target = storage.preferences?.streakWeeklyTarget ?? 3;
            const adjustment = storage.preferences?.streakAdjustment ?? 0;
            const setAt = storage.preferences?.streakAdjustmentSetAt ?? null;
            const c = consistencyStats(allHistory, days, mode, target, adjustment, setAt);
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
  }, [storage, getSessionRows, sessionController, daysSinceMember, exerciseById, mergedExercises, memberSince, earliestSessionDate, volumeExcluded]);

  // Proposals whose save is in flight. The status in `proposals` is the same
  // signal for the card, but a second tap in the same tick reads the closure
  // from before the first tap's update landed, so the ref is what stops it.
  const applyingRef = useRef(new Set<string>());

  const applyProposal = useCallback(async (id: string) => {
    const proposal = proposals[id];
    if (!proposal || proposal.status !== 'pending' || applyingRef.current.has(id)) return;
    applyingRef.current.add(id);
    setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'applying' } }));
    const invalidate = (error: string) =>
      setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error } }));
    // exerciseName is a display hint the proposal adds and must not be
    // persisted. Spread rather than re-list the fields: an untouched exercise
    // carried through an edit still holds template-only data the tool schema
    // never sees (targetWeight, supersetGroup), and rebuilding it
    // field-by-field silently dropped that.
    const persistable = (exercises: ExerciseInput[]) => exercises.map(({ exerciseName: _displayOnly, ...e }) => ({
      ...e,
      setType: normalizeSetType(e.setType),
      restSeconds: e.restSeconds ?? 90,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentTemplate = (templateId: string) => storage.templates.find((t: any) => t.id === templateId);
    // The workout the four session tools write — its screen if one is mounted,
    // its cache if it is minimized — but only if it is still the workout this
    // proposal was built against. A card left over from a workout that was
    // discarded and replaced would otherwise put its change in the new one.
    const sessionTarget = (): SessionMutations | null => {
      const controller = sessionController();
      if (!controller) {
        invalidate('No active workout session.');
        return null;
      }
      const key = currentWorkoutKey();
      // A key is missing only in the half-second before a just-started workout
      // has been cached; there is nothing to compare then, and the tool's own
      // "that exercise is no longer in the session" checks still apply.
      if (proposal.sessionKey && key && key !== proposal.sessionKey) {
        invalidate(WORKOUT_CHANGED_MESSAGE);
        return null;
      }
      return controller;
    };

    try {
      switch (proposal.toolName) {
        case 'create_template': {
          if (proposal.after.kind !== 'template' || !proposal.after.template) return;
          const t = proposal.after.template;
          await storage.saveTemplate({ id: t.id, name: t.name, exercises: persistable(t.exercises) });
          break;
        }
        case 'edit_template': {
          if (proposal.after.kind !== 'template' || !proposal.after.template) return;
          if (proposal.before.kind !== 'template' || !proposal.before.template) return;
          // The proposal replaces the whole exercise list, so it can only be
          // applied to the template it was built from. An edit made in the
          // builder between the proposal and Apply used to be overwritten.
          // A rename sends no list: it is applied to whatever the template
          // holds now, so an append from the same reply applied first does
          // not make the rename refuse.
          const editArgs = proposal.arguments as { exercises?: unknown[] } | undefined;
          const renameOnly = !(editArgs?.exercises && editArgs.exercises.length > 0);
          const current = currentTemplate(proposal.before.template.id);
          if (renameOnly ? !current : templateChangedSince(proposal.before.template, current)) {
            invalidate(TEMPLATE_CHANGED_MESSAGE);
            return;
          }
          const t = proposal.after.template;
          await storage.saveTemplate({
            id: t.id,
            name: t.name,
            exercises: renameOnly && current ? current.exercises : persistable(t.exercises),
          });
          break;
        }
        case 'add_exercises_to_template': {
          if (proposal.after.kind !== 'template' || !proposal.after.template) return;
          if (proposal.before.kind !== 'template' || !proposal.before.template) return;
          // An append is re-derived against the template as it is now, the
          // way add_sets_to_exercise appends to the live block: the snapshot
          // it was proposed on may have been edited since, or another
          // proposal from the same reply may already have been applied.
          const current = currentTemplate(proposal.before.template.id);
          if (!current) {
            invalidate(TEMPLATE_CHANGED_MESSAGE);
            return;
          }
          const beforeIds = new Set(proposal.before.template.exercises.map(e => e.exerciseId));
          const proposed = proposal.after.template.exercises.filter(e => !beforeIds.has(e.exerciseId));
          const currentExercises: ExerciseInput[] = current.exercises ?? [];
          const { additions } = appendableTemplateExercises(currentExercises, proposed);
          if (additions.length === 0) {
            invalidate(`Every exercise in this proposal is already in "${current.name}".`);
            return;
          }
          await storage.saveTemplate({
            id: current.id,
            name: current.name,
            exercises: [...currentExercises, ...persistable(remapSupersetGroups(currentExercises, additions))],
          });
          break;
        }
        case 'delete_template': {
          if (proposal.before.kind !== 'template' || !proposal.before.template) return;
          const blockers = templateDeleteBlockers(proposal.before.template.id, storage);
          if (blockers.length) {
            invalidate(deleteBlockedMessage(proposal.before.template.name, blockers));
            return;
          }
          // Resolves false when the server refused; the proposal stays pending
          // rather than saying Applied over a "Failed to delete" toast.
          if (!(await storage.deleteTemplate(proposal.before.template.id))) return;
          break;
        }
        case 'create_program': {
          if (proposal.after.kind !== 'program' || !proposal.after.program) return;
          const p = proposal.after.program;
          const missing = unknownProgramTemplates(p.days, new Set<string>((storage.templates ?? []).map((t: { id: string }) => t.id)));
          if (missing.length) {
            invalidate(unknownTemplatesMessage(missing));
            return;
          }
          // saveProgram toasts its own failure and resolves false. The proposal
          // then stays pending so Apply can be tapped again; before this it was
          // marked applied and the thread said so while the toast said failed.
          const saved = await storage.saveProgram({
            id: p.id,
            name: p.name,
            days: p.days,
            durationWeeks: p.durationWeeks ?? 8,
            startDate: proposal.arguments?.startDate || formatLocalDate(),
          });
          if (!saved) return;
          break;
        }
        case 'delete_program': {
          if (proposal.before.kind !== 'program' || !proposal.before.program) return;
          if (!(await storage.deleteProgram(proposal.before.program.id))) return;
          break;
        }
        case 'set_active_program': {
          if (proposal.after.kind !== 'active-program' || !proposal.after.programId) return;
          if (!(await storage.setActiveProgram(proposal.after.programId))) return;
          break;
        }
        case 'add_exercise_to_workout': {
          const args = proposal.arguments;
          const controller = sessionTarget();
          if (!controller) return;
          const ok = controller.addExercise(args.exerciseId, args.sets || 3, args.targetReps, args.weight);
          if (!ok) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Exercise is already in the workout.' } }));
            return;
          }
          break;
        }
        case 'add_sets_to_exercise': {
          const args = proposal.arguments;
          const controller = sessionTarget();
          if (!controller) return;
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
          const controller = sessionTarget();
          if (!controller) return;
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
          const controller = sessionTarget();
          if (!controller) return;
          const blocks = controller.getBlocks();
          const targetBlock = blocks.find(b => b.exerciseId === args.exerciseId);
          if (!targetBlock) {
            setProposals(prev => ({ ...prev, [id]: { ...prev[id], status: 'invalid', error: 'Exercise is no longer in the session.' } }));
            return;
          }
          if (blocks.some(b => b.exerciseId === args.newExerciseId)) {
            invalidate(`${exerciseById.get(args.newExerciseId)?.name ?? args.newExerciseId} is already in the workout.`);
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
    } finally {
      applyingRef.current.delete(id);
      // A save that resolved false leaves the proposal pending for another tap.
      setProposals(prev => prev[id]?.status === 'applying' ? { ...prev, [id]: { ...prev[id], status: 'pending' } } : prev);
    }
  }, [proposals, storage, exerciseById, sessionController]);

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

    // Credit balance check (client-side, server also enforces). Premium tier
    // bypasses the gate.
    if (creditsBalance.exhausted) return;

    // Disabled due to consecutive errors. A lockout whose time has passed but
    // whose timer has not fired (throttled background tab) is released here.
    if (lockedUntilRef.current) {
      if (Date.now() < lockedUntilRef.current) return;
      releaseLockout();
    }

    // Cap input to 500 chars
    const cappedText = text.slice(0, 500);

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: cappedText };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    // One controller covers both fetches of the turn. `stalled` records that
    // the abort came from the inactivity timer rather than clearChat/unmount,
    // which is the difference between telling the user and saying nothing.
    const controller = new AbortController();
    turnAbortRef.current = controller;
    const aborted = abortPromise(controller.signal);
    aborted.catch(() => {});
    let stalled = false;
    let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
    const armInactivityTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        stalled = true;
        controller.abort();
      }, STREAM_INACTIVITY_MS);
    };
    const throwIfAborted = () => {
      if (controller.signal.aborted) throw new DOMException('The turn was aborted.', 'AbortError');
    };
    // A chunk that lands in the same tick as the abort must not be applied:
    // clearChat has already emptied the list it would append a bubble to.
    const readChunk = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      armInactivityTimer();
      const chunk = await Promise.race([reader.read(), aborted]);
      throwIfAborted();
      return chunk;
    };

    const context = buildContext();

    // Window: only send last MESSAGE_WINDOW messages
    const allMessages = [...messages, userMsg];
    const windowedMessages = allMessages
      .slice(-MESSAGE_WINDOW)
      .map(m => ({ role: m.role, content: m.content }));

    // Allocate the assistant message id up front so we can associate proposals with it.
    const assistantMessageId = crypto.randomUUID();

    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    try {
      armInactivityTimer();
      // Mirror what supabase.functions.invoke sends: both `apikey` and a Bearer
      // token, preferring the user's session JWT over the anon key when signed
      // in. Inside the timer and the abort: a session lookup that never
      // resolves (auth-js's lock can hang) used to leave the coach loading
      // until a reload, with nothing able to cancel it.
      const { data: { session } } = await Promise.race([supabase.auth.getSession(), aborted]);
      const bearer = session?.access_token ?? anonKey;
      const authHeaders = {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${bearer}`,
      };
      // Each round of the turn is one call to the coach: the first reply, and
      // one more for every round of tool calls it answers with.
      // `conversation` is what those later rounds send back — the assistant
      // turns already produced and the tool results answering them — so a
      // round can act on what an earlier one looked up.
      const conversation: OutboundMessage[] = [...windowedMessages];
      // Where this turn's own user message sits in `conversation`. The server
      // keeps only the last MESSAGE_WINDOW messages and then drops everything
      // ahead of the first user turn, so the turns this one adds have to fit
      // in that window with the user's message still inside it — otherwise the
      // request arrives as tool results whose tool_use was trimmed away, which
      // the Messages API answers with a 400. Older chat messages make room
      // first; when even this turn's own messages do not fit, the turn ends
      // where it is rather than sending a request that cannot be answered.
      let turnStart = conversation.length - 1;
      const conversationFitsWindow = () => {
        while (conversation.length > MESSAGE_WINDOW && turnStart > 0) {
          conversation.shift();
          turnStart--;
        }
        return conversation.length <= MESSAGE_WINDOW;
      };
      // The results of the round just finished. They ride on the next request
      // as `action_results` (the server turns them into tool_result blocks)
      // and are folded into `conversation` on the round after that.
      let pendingResults: ActionResult[] | null = null;
      // Prose from the rounds that have already finished. Every round writes
      // into the same bubble, so a lookup's narration survives the round that
      // acts on what it found.
      let priorContent = '';
      // Turn-scoped, not round-scoped: the same add proposed again in a later
      // round is rejected the way a repeat within one round is.
      const coveredAddExerciseIds = new Set<string>();
      const allToolCalls: ToolCall[] = [];

      // Keyed on the id, not "the last message": an Applied or Discarded note
      // from an earlier proposal can land while this reply streams, and the
      // reply used to continue in a second bubble under the same id.
      const updateAssistant = (content: string, patch: Partial<ChatMessage> = {}) => {
        setMessages(prev => {
          if (prev.some(m => m.id === assistantMessageId)) {
            return prev.map(m => m.id === assistantMessageId ? { ...m, content, ...patch } : m);
          }
          return [...prev, { id: assistantMessageId, role: 'assistant', content, isLoading: true, ...patch }];
        });
      };

      // Read one round's SSE body. Prose is appended to what the rounds before
      // it said rather than replacing it.
      const readRound = async (body: ReadableStream<Uint8Array>): Promise<RoundResult> => {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        const rawToolCalls: (RawToolCallAccumulator | undefined)[] = [];
        let textBuffer = "";
        let content = "";
        // Plain-language reason from the server when the stream dies mid-flight.
        let streamError: string | null = null;
        // Set when the model was cut off at max_tokens — any tool call it was
        // mid-way through emitting is incomplete.
        let truncated = false;
        let streamDone = false;
        while (!streamDone) {
          const { done, value } = await readChunk(reader);
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
              // The function emits { error } instead of a choices chunk when the
              // upstream call fails partway through. It carries no `choices`, so
              // it has to be checked before the chunk shape below.
              if (typeof parsed.error === 'string') {
                streamError = parsed.error;
                streamDone = true;
                break;
              }
              const choice = parsed.choices?.[0];
              if (!choice) continue;

              const delta = choice.delta;
              if (delta?.content) { content += delta.content; updateAssistant(joinRounds(priorContent, content)); }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  if (tc.index !== undefined) {
                    if (!rawToolCalls[tc.index]) rawToolCalls[tc.index] = { id: tc.id || '', name: '', arguments: '' };
                    const acc = rawToolCalls[tc.index]!;
                    if (tc.id) acc.id = tc.id;
                    if (tc.function?.name) acc.name = tc.function.name;
                    if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                  }
                }
              }

              if (choice.finish_reason === 'length') truncated = true;
              if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop' || choice.finish_reason === 'length') streamDone = true;
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }
        return { content, rawToolCalls, truncated, streamError };
      };

      for (let round = 1; round <= MAX_ASSISTANT_ROUNDS; round++) {
        if (!conversationFitsWindow()) break;
        armInactivityTimer();
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            messages: conversation,
            context,
            ...(pendingResults ? { action_results: pendingResults } : {}),
          }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          if (round > 1) {
            // The proposals are already on screen and applyable; only the
            // narration failed. Without this the bubble spins forever. The
            // body's sentence is shown next to the summary because it is the
            // only reason the user gets: a 413 says the fix (a shorter request)
            // is theirs to make, a 402 that the credits ran out between turns.
            const reason = await resp.json().then(b => (typeof b?.error === 'string' ? b.error : ''), () => '');
            const content = [priorContent || toolCallSummary(allToolCalls), reason].filter(Boolean).join(' ');
            updateAssistant(content, { isLoading: false, toolCalls: allToolCalls });
            return;
          }
          const err = await resp.json().catch(() => ({ error: "" }));
          if (resp.status === 413) {
            throw new RequestTooLargeError(err.error || "That message is too large for the coach. Try a shorter one.");
          }
          if (err.balance_exhausted) {
            setCreditsBalance(prev => ({ ...prev, exhausted: true, availableMicros: 0, credits: 0, estMessagesLeft: 0 }));
            // The server has just told us the balance is gone: a known state,
            // not the pre-load placeholder.
            setBalanceKnown(true);
            // Signalled distinctly so the catch block below doesn't tick the
            // consecutive-error counter — running out of credits is not a fault.
            throw new BalanceExhaustedError();
          }
          // Gateway-level errors mean the function never ran. Surface a hint at
          // the most common cause (function not deployed to this Supabase
          // project, or anon-key env var mismatch) instead of a bare status code.
          if (!err.error && (resp.status === 401 || resp.status === 404)) {
            throw new Error(
              resp.status === 404
                ? "AI Coach endpoint not found on this Supabase project. Deploy the ai-coach edge function."
                : "AI Coach is not reachable (401). The ai-coach function may not be deployed, or VITE_SUPABASE_PUBLISHABLE_KEY may not match this project."
            );
          }
          throw new Error(err.error || `Error ${resp.status}`);
        }

        if (round === 1) {
          // Reset consecutive errors on success
          setErrorCount(0);
          setMessages(prev => [...prev, { id: assistantMessageId, role: 'assistant', content: '', isLoading: true }]);
        }

        const { content, rawToolCalls, truncated, streamError } = await readRound(resp.body!);

        // A failed stream leaves half-built tool calls behind; surface the
        // reason rather than proposing them.
        if (streamError) throw new StreamFailedError(streamError);
        priorContent = joinRounds(priorContent, content);

        const { toolCalls: parsedToolCalls, cutOffIds: cutOffToolCallIds } = parseAccumulatedToolCalls(rawToolCalls);

        // A round that asks for nothing ends the turn: the coach has said its
        // piece about whatever the earlier rounds proposed.
        if (parsedToolCalls.length === 0) {
          const fallback = allToolCalls.length
            ? toolCallSummary(allToolCalls)
            : "The coach didn't send a reply. Try again.";
          updateAssistant(priorContent || fallback, {
            isLoading: false,
            ...(allToolCalls.length ? { toolCalls: allToolCalls } : {}),
          });
          return;
        }
        allToolCalls.push(...parsedToolCalls);

        const results: ActionResult[] = [];
        const newProposals: Proposal[] = [];
        for (const tc of parsedToolCalls) {
          tc.status = 'executing';
          if (cutOffToolCallIds.has(tc.id)) {
            const cutOffMessage = truncated ? TRUNCATED_PROPOSAL_MESSAGE : INCOMPLETE_PROPOSAL_MESSAGE;
            tc.status = 'error';
            tc.result = { success: false, message: cutOffMessage };
            newProposals.push({
              id: tc.id,
              messageId: assistantMessageId,
              toolName: tc.name,
              arguments: {},
              before: emptySnapshotFor(tc.name),
              after: emptySnapshotFor(tc.name),
              status: 'invalid',
              error: cutOffMessage,
              suggestions: [],
              summary: `Incomplete ${tc.name.replace(/_/g, ' ')} proposal`,
            });
            results.push({
              tool_call_id: tc.id,
              result: {
                success: false,
                message: `Your ${tc.name} call was cut off before its arguments finished (the response hit the output token limit), so nothing was proposed. Retry with fewer items per call — split the work across several smaller calls.`,
              },
            });
            continue;
          }
          try {
            const { result, proposal } = await proposeToolCall(tc, assistantMessageId);
            tc.result = result;
            tc.status = result?.error ? 'error' : 'done';

            if (proposal && isDuplicateSessionAdd(proposal, coveredAddExerciseIds)) {
              const exId = proposal.arguments.exerciseId as string;
              const exName = exerciseById.get(exId)?.name || exId;
              const msg = `${exName} is already in your workout.`;
              newProposals.push({
                id: tc.id,
                messageId: assistantMessageId,
                toolName: tc.name,
                arguments: tc.arguments,
                before: proposal.before,
                after: proposal.before,
                status: 'invalid',
                error: msg,
                suggestions: [],
                summary: `Invalid ${tc.name.replace(/_/g, ' ')} proposal`,
              });
              results.push({ tool_call_id: tc.id, result: { success: false, message: msg } });
              continue;
            }

            results.push({ tool_call_id: tc.id, result });
            if (proposal) {
              newProposals.push(proposal);
              if (proposal.toolName === 'add_exercise_to_workout' && proposal.status === 'pending') {
                const exId = proposal.arguments?.exerciseId;
                if (typeof exId === 'string') coveredAddExerciseIds.add(exId);
              }
            }
          } catch (err) {
            tc.status = 'error';
            tc.result = { error: String(err) };
            results.push({ tool_call_id: tc.id, result: { error: String(err) } });
          }
        }

        // Proposals built while clearChat emptied the panel must not land in it.
        throwIfAborted();

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

        // Nothing usable survived: the reply was cut off at max_tokens and
        // every tool call in it went with it. Another round would be a second
        // metered call whose only product is a sentence restating the card the
        // user is already looking at.
        if (truncated && parsedToolCalls.every(tc => cutOffToolCallIds.has(tc.id))) {
          updateAssistant(joinRounds(priorContent, TRUNCATED_PROPOSAL_MESSAGE), {
            isLoading: false,
            toolCalls: allToolCalls,
          });
          return;
        }

        // The previous round's results were delivered as `action_results`;
        // they belong in the history from here on, ahead of this round's turn.
        for (const r of pendingResults ?? []) {
          conversation.push({ role: 'tool', tool_call_id: r.tool_call_id, content: JSON.stringify(r.result) });
        }
        conversation.push({
          role: 'assistant',
          content: content || null,
          tool_calls: parsedToolCalls.map(tc => ({
            id: tc.id, type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        });
        pendingResults = results;
      }

      // The round cap, reached: a normal end, not a failure. The proposals are
      // on screen; the coach just does not get another paid call to narrate
      // them.
      updateAssistant(priorContent || toolCallSummary(allToolCalls), {
        isLoading: false,
        toolCalls: allToolCalls,
      });
    } catch (err) {
      // Replaces this turn's bubble, or appends one when the turn never got
      // that far. Keyed on the id, not "the last message": an "Applied" note
      // from a proposal accepted mid-stream can be last, and used to be
      // overwritten.
      const showReply = (errMsg: string) => setMessages(prev => {
        if (prev.some(m => m.id === assistantMessageId)) {
          return prev.map(m => m.id === assistantMessageId ? { ...m, content: errMsg, isLoading: false } : m);
        }
        return [...prev, { id: assistantMessageId, role: 'assistant', content: errMsg, isLoading: false }];
      });

      // An aborted turn is not a fault of the service. clearChat and unmount
      // have nothing left to say it to; the inactivity timer does.
      if (controller.signal.aborted) {
        if (stalled) showReply(STALLED_STREAM_MESSAGE);
        return;
      }

      console.error('Chat error:', err);

      // Balance-exhausted is a normal terminal state, not a fault. Show the
      // out-of-credits message and stop — don't tick the consecutive error
      // counter that would trip the 5-minute lockout on someone who just
      // needs to top up.
      if (err instanceof BalanceExhaustedError) {
        showReply("You're out of AI credits. Top up or check your plan to keep chatting.");
        return;
      }

      if (err instanceof RequestTooLargeError) {
        showReply(err.message);
        return;
      }

      const newErrorCount = consecutiveErrorsRef.current + 1;
      setErrorCount(newErrorCount);

      // After 2 consecutive failures, disable for 5 minutes
      if (newErrorCount >= 2) {
        lockOut(Date.now() + DISABLE_DURATION_MS);
        showReply(LOCKED_OUT_MESSAGE);
      } else {
        showReply(err instanceof StreamFailedError
          ? err.message
          : `Something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}. Try again.`);
      }
    } finally {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      if (turnAbortRef.current === controller) turnAbortRef.current = null;
      setIsLoading(false);
      // Re-sync the authoritative balance after the turn (cost is metered
      // server-side and unknown to the client). god-mode does not deduct.
      resyncBalanceSoon();
    }
  }, [messages, buildContext, proposeToolCall, creditsBalance, releaseLockout, setErrorCount, lockOut, resyncBalanceSoon]);

  const clearChat = useCallback(() => {
    turnAbortRef.current?.abort();
    turnAbortRef.current = null;
    setMessages([]);
    setProposals({});
    setProposalIdsByMessage({});
    // The lockout stays: it is what keeps a failing backend from being
    // hammered, and the trash icon must not be a one-tap way around it.
  }, []);

  return (
    <ChatContext.Provider value={{
      messages, isOpen, isLoading, currentScreen,
      setOpen, sendMessage, clearChat, registerScreen, quickChips,
      creditsBalance, creditsBalanceKnown: balanceKnown, refreshBalance, consecutiveErrors, cooldownActive, lockedUntil,
      proposals, proposalIdsByMessage, applyProposal, discardProposal,
    }}>
      {children}
    </ChatContext.Provider>
  );
};
