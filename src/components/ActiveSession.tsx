import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { flushSync } from 'react-dom';
import type { ExerciseId, ExerciseLog, SetType, WorkoutSession, WorkoutSet, TemplateExercise } from '@/types/workout';
import { getExerciseInputMode, BAND_LEVELS, getBandLevelLabel, isTimeBased, isDistanceBased, usesReps, usesWeight, fromMeters, toMeters, distanceUnitFromWeightUnit, type ExerciseInputMode, type DistanceUnit } from '@/utils/exerciseInputMode';
import { EXERCISES } from '@/types/workout';
import { targetWeightToInput, inputToTargetWeight } from '@/utils/weightConversion';
import { validateWeight, validateReps, validateRpe, canCompleteSet, getSetFieldErrors } from '@/utils/setValidation';
import { parseLocalDate } from '@/utils/dateUtils';
import { findPreviousPerformance } from '@/utils/previousPerformance';
import { repairBlockNames, resolveExerciseName } from '@/utils/exerciseNames';
import { resolveTemplateSupersets, withoutLoneSupersetGroups, withoutLoneSupersets } from '@/utils/templateSupersets';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useSessionRestTimer } from '@/hooks/useSessionRestTimer';
import { releaseRestSchedule } from '@/utils/restTimerScheduler';
import { useBlockMutations, normalizeBlocks } from '@/hooks/useBlockMutations';
import { CameraFeed } from '@/components/CameraFeed';
import { cn } from '@/lib/utils';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { useTutorial } from '@/contexts/TutorialContext';
import { SupersetLinker } from '@/components/SupersetLinker';
import { Button } from '@/components/ui/button';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { Check, Plus, MoreHorizontal, MoreVertical, StickyNote, FileText, Flame, Timer, RefreshCw, Layers, ChevronDown, Trash2, X, ArrowLeft, Pause, Play, MapPin, Focus, Camera } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RpeWheelPicker } from '@/components/RpeWheelPicker';
import { useStickyNotes } from '@/hooks/useStickyNotes';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ExerciseRestTimer, type TimerId } from '@/components/ExerciseRestTimer';
import { CountdownOverlay } from '@/components/CountdownOverlay';
import { formatMmSs, parseMmSs, timeToSeconds } from '@/utils/timeFormat';
import { registerSession, unregisterSession } from '@/hooks/useSessionController';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableExerciseItem } from '@/components/SortableExerciseItem';
import { ExerciseDetailModal } from '@/components/ExerciseDetailModal';
import { FocusMode } from '@/components/FocusMode';
import {
  snapshotFromTemplateExercises,
  snapshotFromFinishedBlocks,
  diffTemplateSnapshots,
  buildUpdatedTemplate,
  type TemplateSnapshot,
  type FinishedBlockLite,
} from '@/utils/templateDiff';
import type { WorkoutTemplate } from '@/types/workout';

import type { WeightUnit } from '@/hooks/useStorage';


// Re-export shared types from dedicated module
export type { TimerStatus, PersistedTimer, ActiveSessionCache, DropRow, SetRow, RunningSetState, ExerciseBlock } from '@/types/activeSession';
import type { PersistedTimer, ActiveSessionCache, DropRow, SetRow, RunningSetState, ExerciseBlock } from '@/types/activeSession';
import { supersetInfo } from '@/types/activeSession';
import { ExerciseTable, timerIdKey } from '@/components/ExerciseTableComponent';
export { ExerciseTable, type ExerciseTableProps } from '@/components/ExerciseTableComponent';

import { ACTIVE_SESSION_CACHE_KEY as CACHE_KEY } from '@/utils/localDrafts';
const DEFAULT_LOCATION = 'Home Gym';

// Bounds for the in-session rest-length editor. The floor is 5s rather than 0
// because a zero-length rest reaches `ensureRestSchedule` already expired and
// fires the "Rest complete" toast and notification the instant the set is
// ticked; the ceiling keeps a typo out of a 15-minute rest bar.
const MIN_REST_SECONDS = 5;
const MAX_REST_SECONDS = 900;
const REST_PRESETS = [60, 90, 120, 180];

// Safe localStorage write — never throws
function safeWriteCache(cache: ActiveSessionCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('[ActiveSession] Failed to write cache:', e);
  }
}

// The weight column a finished set stores, per input mode:
//   distance-only modes  -> no weight at all
//   band                 -> the level as chosen, never unit-converted
//   everything else      -> the typed display value converted to kg
const noopStartTimer = () => {};

/**
 * Everything the edit screen can change about a saved workout, as one string.
 * Cancelling an edit asks before discarding, and only when there is something
 * to discard — so this deliberately leaves out what the screen rewrites on the
 * way in without being asked: `exerciseName` (re-resolved once the custom
 * library lands), `restSeconds` and `dropSetsEnabled` (neither is editable
 * here, and neither is written back). Comparing whole blocks would read that
 * normalisation as an edit and make closing an untouched record a two-tap job.
 */
function editStateSignature(
  blocks: ExerciseBlock[],
  scalars: { note: string; location: string; date: string; startTime: string; durationMin: string },
): string {
  return JSON.stringify({
    ...scalars,
    blocks: blocks.map(b => ({
      id: b.exerciseId,
      group: b.supersetGroup ?? null,
      note: b.note ?? '',
      sets: b.sets.map(set => [
        set.setNumber, set.type, set.weight, set.reps, set.rpe, set.time ?? '', set.distance ?? '', set.completed,
        (set.drops ?? []).map(d => [d.weight, d.reps, d.rpe, d.time ?? '', d.distance ?? '', d.completed]),
      ]),
    })),
  });
}

export function clearSessionCache() {
  localStorage.removeItem(CACHE_KEY);
  // The workout is over, so is its rest: the scheduler outlives this screen
  // on purpose (a minimized session keeps its rest), and this is the one
  // signal that the session it belonged to is gone.
  releaseRestSchedule();
}

/**
 * The workout in progress, as it was last written.
 *
 * Which of the two copies is the workout is a rule, not a race. While this
 * screen is mounted it owns the workout and its debounced flush is the only
 * writer of this cache: the AI coach reaches the workout through the session
 * controller registered below and deliberately does not touch the cache, whose
 * next flush would overwrite anything it wrote. The moment the screen unmounts
 * — which is what minimizing a workout does — the cache IS the workout, and the
 * coach reads and writes it directly, so a suggestion made before the minimize
 * can still be applied after it. This screen reads the result back the next
 * time it mounts, which is why the change is on screen after Resume. The other
 * half of the rule is "The workout with no screen on it" in ChatContext.
 */
export function getSessionCache(): ActiveSessionCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface ActiveSessionProps {
  exercises: ExerciseId[];
  templateExercises?: TemplateExercise[];
  customLocations?: string[];
  onUpdateCustomLocations?: (locations: string[]) => void;
  stickyNotes?: Record<string, string>;
  onUpdateStickyNotes?: (notes: Partial<import('@/hooks/useStorage').UserPreferences>) => Promise<void>;
  templateName?: string;
  templateId?: string;
  template?: WorkoutTemplate | null;
  history?: WorkoutSession[];
  weightUnit?: WeightUnit;
  defaultDropSetsEnabled?: boolean;
  defaultRestSeconds?: number;
  cachedSession?: ActiveSessionCache | null;
  editSession?: WorkoutSession | null;
  /**
   * Kept pointed at this screen's unsaved-edit state so the router can ask
   * before Back throws an edit away. The X in the corner asks directly; on a
   * phone Back is the way most people leave, and it owns the history entry,
   * so the question has to be reachable from there too.
   */
  editGuard?: React.MutableRefObject<{ hasChanges: boolean; confirm: () => void } | null>;
  onFinish: (session: WorkoutSession) => void;
  onCancel: () => void;
  onMinimize?: () => void;
  onUpdateTemplate?: (template: WorkoutTemplate) => void | Promise<boolean | void>;
  hideTimersPref?: boolean;
  onUpdateHideTimers?: (val: boolean) => void;
}

// normalizeBlocks is imported from useBlockMutations

export const ActiveSession: React.FC<ActiveSessionProps> = ({ exercises: initialExercises, templateExercises, templateName, templateId, template, history = [], weightUnit = 'kg', defaultDropSetsEnabled = false, defaultRestSeconds = 90, cachedSession: cachedSessionProp, editSession, editGuard, onFinish, onCancel, onMinimize, onUpdateTemplate, hideTimersPref = false, onUpdateHideTimers, customLocations: propLocations = ['Home Gym'], onUpdateCustomLocations, stickyNotes: propStickyNotes = {}, onUpdateStickyNotes }) => {
  const isEditMode = !!editSession;
  // A cache belongs to the workout it was written for. Mounting one whose
  // template differs from the screen's is how starting a workout on top of a
  // minimized one used to carry the previous workout's blocks, name, timer and
  // template snapshot into the new template — which then offered to overwrite
  // that template with the old workout's exercises. Index only hands the cache
  // to a screen that is resuming; this is the backstop for any path that
  // forgets to.
  const cachedSession = cachedSessionProp && (cachedSessionProp.templateId ?? null) === (templateId ?? null)
    ? cachedSessionProp
    : null;
  const distanceUnit = distanceUnitFromWeightUnit(weightUnit);
  // Scanning every logged session per exercise, on a component that re-renders
  // on each keystroke, adds up — so the answers are cached until history moves.
  const previousFor = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof findPreviousPerformance>>();
    return (exerciseId: ExerciseId) => {
      let found = cache.get(exerciseId);
      if (!found) {
        found = findPreviousPerformance(history, exerciseId, editSession);
        cache.set(exerciseId, found);
      }
      return found;
    };
  }, [history, editSession]);
  const { exercises: customExercises } = useCustomExercisesContext();
  const { active: tutorialActive } = useTutorial();
  // Convert saved session exercises back to blocks for editing.
  // Rebuilds nested `drops` from flat saved WorkoutSet[] (consecutive 'dropset'
  // rows attach to the most recent non-dropset parent of the same setNumber).
  const editBlocks = useMemo<ExerciseBlock[] | null>(() => {
    if (!editSession) return null;
    return editSession.exercises.map(ex => {
      const isBand = getExerciseInputMode(ex.exerciseId, customExercises) === 'band';
      // Repair flat sets: if the first row of a setNumber is 'dropset' (legacy
      // bug), coerce it to a real parent so we have something to nest under.
      const seenParent = new Set<number>();
      for (const s of ex.sets) {
        if (s.type !== 'dropset') seenParent.add(s.setNumber);
      }
      const claimed = new Set<number>();
      const repaired = ex.sets.map(s => {
        if (s.type === 'dropset' && !seenParent.has(s.setNumber) && !claimed.has(s.setNumber)) {
          claimed.add(s.setNumber);
          return { ...s, type: (ex.supersetGroup !== undefined ? 'superset' : 'normal') as SetType };
        }
        return s;
      });

      // Stored in metres; the input holds the user's unit. Omitting this is
      // what silently erased every distance when a session was edited and saved.
      const displayDistance = (d: number | null | undefined) =>
        d == null ? '' : String(fromMeters(d, distanceUnit));

      const rows: SetRow[] = [];
      for (const s of repaired) {
        if (s.type === 'dropset' && rows.length > 0) {
          const parent = rows[rows.length - 1];
          parent.drops = parent.drops ?? [];
          parent.drops.push({
            weight: targetWeightToInput(s.weight, weightUnit, isBand),
            reps: s.reps.toString(),
            rpe: s.rpe?.toString() ?? '',
            completed: true,
            time: s.time != null ? String(s.time) : '',
            distance: displayDistance(s.distance),
          });
        } else {
          rows.push({
            setNumber: s.setNumber,
            weight: targetWeightToInput(s.weight, weightUnit, isBand),
            reps: s.reps.toString(),
            completed: true,
            type: s.type,
            rpe: s.rpe?.toString() ?? '',
            time: s.time != null ? String(s.time) : '',
            distance: displayDistance(s.distance),
          });
        }
      }
      return {
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        restSeconds: defaultRestSeconds,
        supersetGroup: ex.supersetGroup,
        sets: rows,
        dropSetsEnabled: rows.some(r => (r.drops?.length ?? 0) > 0),
        note: ex.note,
      };
    });
  }, [editSession, weightUnit, defaultRestSeconds, customExercises]);

  // A template can express a superset two ways (an explicit group id, or the
  // older setType-only form the AI tools still write); the session only
  // understands the group id, so links are resolved here before anything
  // reads the template — the blocks below and the update-template snapshot
  // both, so a workout run exactly as planned never reports a superset change.
  const resolvedTemplateExercises = useMemo(
    () => (templateExercises ? resolveTemplateSupersets(templateExercises) : undefined),
    [templateExercises],
  );

  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() => {
    if (editBlocks) return normalizeBlocks(editBlocks);
    if (cachedSession) return normalizeBlocks(cachedSession.blocks);
    return initialExercises.map((id, idx) => {
      const tpl = resolvedTemplateExercises?.[idx];
      const numSets = tpl?.sets ?? 3;
      const restSec = tpl?.restSeconds ?? defaultRestSeconds;
      const mode = getExerciseInputMode(id, customExercises);
      const isBand = mode === 'band';
      // A timed exercise's planned duration lives in the template's targetReps
      // — that is the cell the builder labels "Time (min)" — and the session's
      // time field holds seconds, so it is carried over multiplied by 60. Like
      // the distance target above, it is a prefill: the box opens holding the
      // plan instead of empty, and a set ticked without touching it records
      // the planned time as performed.
      const plannedSeconds = isTimeBased(mode) && typeof tpl?.targetReps === 'number' && tpl.targetReps > 0
        ? Math.round(tpl.targetReps * 60)
        : null;
      return {
        exerciseId: id,
        exerciseName: EXERCISES[id]?.name ?? customExercises.find(c => c.id === id)?.name ?? id,
        restSeconds: restSec,
        supersetGroup: tpl?.supersetGroup,
        dropSetsEnabled: defaultDropSetsEnabled,
        sets: Array.from({ length: numSets }, (_, i) => ({
          setNumber: i + 1,
          weight: targetWeightToInput(tpl?.targetWeight, weightUnit, isBand),
          reps: tpl?.targetReps === 'failure' ? '' : (tpl?.targetReps?.toString() ?? ''),
          // Stored in metres; the box holds the user's unit, trimmed to two
          // decimals so a 5000 m target reads 3.11 mi rather than 17 digits.
          distance: tpl?.targetDistance != null ? String(Number(fromMeters(tpl.targetDistance, distanceUnit).toFixed(2))) : '',
          completed: false,
          type: tpl?.setType ?? 'normal',
          rpe: '',
          time: plannedSeconds != null ? String(plannedSeconds) : '',
        })),
      };
    });
  });

  // ===== Extracted hooks =====
  const restTimer = useSessionRestTimer({ cachedSession, hideTimers: hideTimersPref });
  const { activeTimer, restRecords, computeRemaining, recalcRestTimer, startTimer, skipTimer, extendTimer } = restTimer;

  // Per-set live timing state (5s countdown -> running)
  const [countdown, setCountdown] = useState<{ blockIdx: number; setIdx: number; dropIdx?: number } | null>(null);
  const [runningSet, setRunningSet] = useState<RunningSetState | null>(
    cachedSession?.runningSet ?? null
  );

  // Both are positions into `blocks`, and the mutations move rows under
  // them: a warm-up prepended above a stopwatch set, or a row or exercise
  // deleted above it, left the index on a different row and Stop wrote the
  // time and completion there. A row that is gone ends what was on it.
  // The rest timer and the recorded rests are keyed by the same positions.
  const { remapTimerIds } = restTimer;
  const shiftSetIndices = useCallback((blockIdx: number, remap: (setIdx: number) => number | null) => {
    const shifted = <T extends { blockIdx: number; setIdx: number }>(s: T | null): T | null => {
      if (!s || s.blockIdx !== blockIdx) return s;
      const setIdx = remap(s.setIdx);
      return setIdx === null ? null : setIdx === s.setIdx ? s : { ...s, setIdx };
    };
    setRunningSet(shifted);
    setCountdown(shifted);
    remapTimerIds(id => {
      if (id.blockIdx !== blockIdx || id.setIdx === undefined) return id;
      const setIdx = remap(id.setIdx);
      return setIdx === null ? null : setIdx === id.setIdx ? id : { ...id, setIdx };
    });
  }, [remapTimerIds]);
  const shiftBlockIndices = useCallback((remap: (blockIdx: number) => number | null) => {
    const shifted = <T extends { blockIdx: number }>(s: T | null): T | null => {
      if (!s) return s;
      const blockIdx = remap(s.blockIdx);
      return blockIdx === null ? null : blockIdx === s.blockIdx ? s : { ...s, blockIdx };
    };
    setRunningSet(shifted);
    setCountdown(shifted);
    remapTimerIds(id => {
      const blockIdx = remap(id.blockIdx);
      return blockIdx === null ? null : blockIdx === id.blockIdx ? id : { ...id, blockIdx };
    });
  }, [remapTimerIds]);
  const shiftDropIndices = useCallback((blockIdx: number, setIdx: number | null, remap: (dropIdx: number) => number | null) => {
    const shifted = <T extends { blockIdx: number; setIdx: number; dropIdx?: number }>(s: T | null): T | null => {
      if (!s || s.blockIdx !== blockIdx || s.dropIdx === undefined) return s;
      if (setIdx !== null && s.setIdx !== setIdx) return s;
      const dropIdx = remap(s.dropIdx);
      return dropIdx === null ? null : dropIdx === s.dropIdx ? s : { ...s, dropIdx };
    };
    setRunningSet(shifted);
    setCountdown(shifted);
    remapTimerIds(id => {
      if (id.blockIdx !== blockIdx || id.dropIdx === undefined) return id;
      if (setIdx !== null && id.setIdx !== setIdx) return id;
      const dropIdx = remap(id.dropIdx);
      return dropIdx === null ? null : dropIdx === id.dropIdx ? id : { ...id, dropIdx };
    });
  }, [remapTimerIds]);

  // Re-ticking a set while editing history must not start a real rest timer
  // (sound, OS notification, permission prompt), so edit mode gets a no-op.
  const blockOps = useBlockMutations(blocks, setBlocks, {
    weightUnit,
    defaultDropSetsEnabled,
    defaultRestSeconds,
    customExercises,
    startTimer: isEditMode ? noopStartTimer : startTimer,
    onSetIndicesShifted: shiftSetIndices,
    onBlockIndicesShifted: shiftBlockIndices,
    onDropIndicesShifted: shiftDropIndices,
  });
  const { exerciseLookup, updateSet, toggleSetComplete, addSet, addDrop, updateDrop, removeSet, removeDrop, addExercise, addMultipleExercises, removeExercise, replaceExercise, toggleDropSets, addWarmupSet } = blockOps;

  // A block's exerciseName is captured when the block is created, but custom
  // exercises load from the network after mount — a block created in that
  // window fell back to the raw `custom-<uuid>` id and kept it for the rest of
  // the workout, cache and saved log included. Re-resolve every block against
  // the live library instead of trusting the name each writer snapshotted.
  // repairBlockNames returns the same array when nothing changed, so the
  // setBlocks bails out rather than looping.
  useEffect(() => {
    setBlocks(prev => repairBlockNames(prev, exerciseLookup));
  }, [exerciseLookup, blocks]);
  const [workoutName, setWorkoutName] = useState(() => {
    if (cachedSession?.workoutName) return cachedSession.workoutName;
    if (editSession) return 'Workout';
    if (templateName && templateExercises && templateExercises.length > 0) {
      const tplIds = templateExercises.map(e => e.exerciseId).join('|');
      let count = 0;
      for (const s of history) {
        const ids = s.exercises.map(e => e.exerciseId).join('|');
        if (ids === tplIds) count++;
      }
      return `${templateName} ${count + 1}`;
    }
    return 'Workout';
  });
  const [workoutNote, setWorkoutNote] = useState(cachedSession?.workoutNote ?? editSession?.note ?? '');
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  // In edit mode there is no cache; falling straight to the default is what
  // rewrote every edited workout's location to 'Home Gym' on save.
  const [location, setLocation] = useState(cachedSession?.location ?? editSession?.location ?? DEFAULT_LOCATION);
  const [locations, setLocations] = useState<string[]>(propLocations);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [newLocationInput, setNewLocationInput] = useState('');
  const [deleteLocationConfirm, setDeleteLocationConfirm] = useState<string | null>(null);
  const [pendingRemoveIdx, setPendingRemoveIdx] = useState<number | null>(null);
  const [showExercisePicker, setShowExercisePicker] = useState(cachedSession?.showExercisePicker ?? false);
  const [pendingExerciseIds, setPendingExerciseIds] = useState<ExerciseId[]>(cachedSession?.pendingExerciseIds ?? []);
  // Transient — not persisted to ActiveSessionCache. A cold reload that resumes the
  // picker should land in add mode rather than a half-completed replace flow.
  const [replaceIdx, setReplaceIdx] = useState<number | null>(null);
  const [showSupersetLinker, setShowSupersetLinker] = useState(false);
  // Same stale-snapshot hazard as startTime below: elapsedAtCache is debounced
  // and can lag well behind reality, so a running (non-paused) resume computes
  // the true elapsed from the fixed startTimestamp instead. A paused resume
  // has no live clock to compute from, so it keeps the frozen snapshot.
  const [elapsedSeconds, setElapsedSeconds] = useState(() => {
    if (cachedSession) {
      return cachedSession.timerPaused
        ? cachedSession.elapsedAtCache
        : Math.floor((Date.now() - cachedSession.startTimestamp) / 1000);
    }
    return editSession?.duration ?? 0;
  });
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // Pending session held while we ask the user whether to save a <30s workout.
  // Replaces the old window.confirm(), which is suppressed by some mobile
  // WebViews so the guardrail silently defaulted through.
  const [pendingShortWorkout, setPendingShortWorkout] = useState<WorkoutSession | null>(null);
  const [showFocusMode, setShowFocusMode] = useState(cachedSession?.showFocusMode ?? false);
  const [hideTimers, setHideTimers] = useState(hideTimersPref);
  const [detailExerciseId, setDetailExerciseId] = useState<ExerciseId | null>(null);
  const [timerPaused, setTimerPaused] = useState(cachedSession?.timerPaused ?? false);
  const [cameraOpen, setCameraOpen] = useState(false);
  // Anchor to the cached startTimestamp, not elapsedAtCache: the cache write is
  // debounced (see flushCache below), so elapsedAtCache can be several minutes
  // stale by the time a minimized session is reopened, while startTimestamp is
  // a fixed instant that never goes stale. Reconstructing from elapsedAtCache
  // made this timer restart from that stale snapshot and drift from the
  // MinimizedSessionBar, which already reads startTimestamp directly.
  const startTime = useRef(cachedSession ? cachedSession.startTimestamp : Date.now());
  const trueStart = useRef(cachedSession ? (cachedSession.trueStartTimestamp ?? cachedSession.startTimestamp) : startTime.current);
  // Restore paused elapsed so a mid-pause reload keeps the frozen counter
  // instead of jumping when the user resumes.
  const pausedElapsed = useRef<number | null>(
    cachedSession?.timerPaused ? (cachedSession.pausedElapsedSec ?? cachedSession.elapsedAtCache) : null
  );
  const updateStickyNotesFn = onUpdateStickyNotes ?? (async () => {});
  const { getStickyNote, setStickyNote } = useStickyNotes(propStickyNotes, updateStickyNotesFn);

  // Snapshot the original template structure so the finish flow can diff
  // against it. Prefer the cached snapshot when resuming from a minimize
  // (or a cold reload) so we don't lose the "before" state; otherwise
  // compute it fresh from templateExercises. Only null in edit mode or
  // when the workout wasn't launched from a template at all.
  const originalTemplateSnapshot = useRef<TemplateSnapshot | null>(
    isEditMode
      ? null
      : cachedSession?.templateSnapshot
        ?? (resolvedTemplateExercises && templateId
          ? snapshotFromTemplateExercises(resolvedTemplateExercises)
          : null)
  );

  // Cached alongside the snapshot: flushCache has no reactive deps, and the
  // restored screen needs the id to find the template again after a reload.
  const templateIdRef = useRef<string | null>(templateId ?? cachedSession?.templateId ?? null);
  useEffect(() => {
    if (templateId) templateIdRef.current = templateId;
  }, [templateId]);

  // Guards the dialog against acting twice on one decision: the button's own
  // handler and the close that follows it both see the pre-click state.
  const templateChoiceMade = useRef(false);

  // Pending finished session — held while we ask the user about updating the template
  const [pendingFinishedSession, setPendingFinishedSession] = useState<WorkoutSession | null>(null);
  const [pendingTemplateUpdate, setPendingTemplateUpdate] = useState<{
    template: WorkoutTemplate;
    summary: string;
  } | null>(null);

  // Edit mode: date/time state
  const [editDate, setEditDate] = useState(() => {
    if (!editSession) return '';
    const d = parseLocalDate(editSession.date);
    return format(d, 'yyyy-MM-dd');
  });
  const [editTime, setEditTime] = useState(() => {
    if (!editSession) return '';
    if (editSession.startedAt) {
      return format(new Date(editSession.startedAt), 'HH:mm');
    }
    return '';
  });
  const [editDurationMin, setEditDurationMin] = useState(() => {
    if (!editSession) return '';
    return Math.floor(editSession.duration / 60).toString();
  });
  // The field shows whole minutes; writing it back unconditionally truncated
  // a 32:40 workout to 32:00 on every edit, whether or not it was touched.
  // Same for the start: rebuilt from the date and HH:mm fields only when one
  // of them changed, or every edit dropped the seconds — and moved a workout
  // that started before midnight (startedAt on one day, date on the next)
  // forward a day each time it was opened.
  const initialEditDurationMin = useRef(editDurationMin);
  const initialEditDate = useRef(editDate);
  const initialEditTime = useRef(editTime);

  // Cancelling an edit throws the work away, so it asks first — but only when
  // something was actually changed, so opening a record and closing it stays
  // one tap. The baseline is taken on the first render, from the same blocks
  // the screen was seeded with, rather than recomputed from `editSession`:
  // recomputing would move under us when the custom-exercise library loads and
  // read as an edit nobody made.
  const editSignature = useMemo(
    () => (isEditMode
      ? editStateSignature(blocks, {
          note: workoutNote,
          location,
          date: editDate,
          startTime: editTime,
          durationMin: editDurationMin,
        })
      : ''),
    [isEditMode, blocks, workoutNote, location, editDate, editTime, editDurationMin],
  );
  const [editBaselineSignature] = useState(() => editSignature);
  const editHasChanges = isEditMode && editSignature !== editBaselineSignature;
  const [showDiscardEditsConfirm, setShowDiscardEditsConfirm] = useState(false);

  useEffect(() => {
    if (!editGuard) return;
    editGuard.current = { hasChanges: editHasChanges, confirm: () => setShowDiscardEditsConfirm(true) };
    return () => { editGuard.current = null; };
  }, [editGuard, editHasChanges]);

  const addCustomLocation = useCallback(() => {
    const trimmed = newLocationInput.trim();
    if (trimmed && !locations.includes(trimmed)) {
      const updated = [...locations, trimmed];
      setLocations(updated);
      onUpdateCustomLocations?.(updated);
    }
    setLocation(trimmed || location);
    setNewLocationInput('');
    setShowLocationDropdown(false);
  }, [newLocationInput, locations, location, onUpdateCustomLocations]);

  // Rest timer state is managed by useSessionRestTimer hook (above)

  const blockRefs = useRef<Record<number, HTMLDivElement | null>>({});
  // Note editing state
  const [editingNote, setEditingNote] = useState<{ blockIdx: number; type: 'note' | 'sticky' } | null>(null);
  const [noteText, setNoteText] = useState('');
  // Rest-length editing state (the exercise menu's "Update Rest Timer")
  const [editingRest, setEditingRest] = useState<{ exerciseId: string } | null>(null);
  const [restInput, setRestInput] = useState('');

  // Elapsed timer — uses Date.now() anchor for absolute start, recalculates on tick
  useEffect(() => {
    if (timerPaused) return;
    const recalcElapsed = () => {
      setElapsedSeconds(Math.floor((Date.now() - startTime.current) / 1000));
    };
    const interval = setInterval(recalcElapsed, 1000);
    // Instant catch-up when returning from background
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        recalcElapsed();
        recalcRestTimer();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [timerPaused, recalcRestTimer]);

  // Ref snapshot of every state field persisted by the cache writer. The same
  // list appears in three places that MUST stay aligned: this ref initializer,
  // the dependency array of the schedule-write effect below, and the
  // safeWriteCache() call inside flushCache. react-hooks/exhaustive-deps will
  // flag any state used in the schedule effect that's not in the deps array.
  const cacheStateRef = useRef({
    blocks, workoutName, location, workoutNote, activeTimer,
    restRecords, runningSet, showFocusMode, showExercisePicker,
    pendingExerciseIds, isEditMode, timerPaused,
  });
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushCache = useCallback(() => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    const s = cacheStateRef.current;
    if (s.isEditMode) return;
    // While paused, pausedElapsed.current holds the frozen elapsed time and
    // startTime.current is NOT advanced. Persist that snapshot so the
    // MinimizedSessionBar can display a frozen counter instead of ticking
    // against the stale startTime.
    const pausedSec = s.timerPaused ? pausedElapsed.current : null;
    safeWriteCache({
      blocks: s.blocks,
      workoutName: s.workoutName,
      startTimestamp: startTime.current,
      trueStartTimestamp: trueStart.current,
      elapsedAtCache: s.timerPaused && pausedSec != null
        ? pausedSec
        : Math.floor((Date.now() - startTime.current) / 1000),
      location: s.location,
      workoutNote: s.workoutNote,
      activeTimer: s.activeTimer,
      restRecords: s.restRecords,
      runningSet: s.runningSet,
      showFocusMode: s.showFocusMode,
      showExercisePicker: s.showExercisePicker,
      pendingExerciseIds: s.pendingExerciseIds,
      timerPaused: s.timerPaused,
      pausedElapsedSec: pausedSec,
      templateSnapshot: originalTemplateSnapshot.current,
      templateId: templateIdRef.current,
    });
  }, []);

  // Persist active session state to localStorage — debounced 500ms, skipped in edit mode.
  // startTime is a ref (stable identity); startTime.current is read fresh inside flushCache
  // so it does not need to be a reactive dependency.
  useEffect(() => {
    cacheStateRef.current = {
      blocks, workoutName, location, workoutNote, activeTimer,
      restRecords, runningSet, showFocusMode, showExercisePicker,
      pendingExerciseIds, isEditMode, timerPaused,
    };
    if (isEditMode) return;
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    writeTimerRef.current = setTimeout(flushCache, 500);
  }, [blocks, workoutName, location, workoutNote, activeTimer, restRecords, runningSet, showFocusMode, showExercisePicker, pendingExerciseIds, isEditMode, timerPaused, flushCache]);

  // Flush immediately on page hide / tab switch to background (mobile Safari).
  // flushCache is stable, so listeners are attached once for the session lifetime.
  useEffect(() => {
    window.addEventListener('pagehide', flushCache);
    document.addEventListener('visibilitychange', flushCache);
    return () => {
      window.removeEventListener('pagehide', flushCache);
      document.removeEventListener('visibilitychange', flushCache);
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
        // A write still pending on unmount belongs to a session being
        // minimized — a rest started or skipped in the last half-second would
        // otherwise be in the scheduler but not in the cache, and the screen
        // would come back without it. A session that ended has had its cache
        // cleared first, and that must stay cleared.
        if (localStorage.getItem(CACHE_KEY) !== null) flushCache();
      }
    };
  }, [flushCache]);

  const toggleTimerPause = useCallback(() => {
    setTimerPaused(prev => {
      if (!prev) {
        // Pausing: save current elapsed
        pausedElapsed.current = Math.floor((Date.now() - startTime.current) / 1000);
      } else {
        // Resuming: adjust startTime so elapsed stays continuous
        if (pausedElapsed.current !== null) {
          startTime.current = Date.now() - (pausedElapsed.current * 1000);
          pausedElapsed.current = null;
        }
      }
      return !prev;
    });
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // updateSet and toggleSetComplete are provided by useBlockMutations hook

  // Internal: stop a running set (or dropset), write its duration into time, mark complete, start rest timer.
  // bonusSeconds is added when the user starts a NEW set while one is still running (per spec: +5s).
  const stopRunningSet = useCallback((bonusSeconds: number = 0) => {
    if (!runningSet) return;
    const { blockIdx, setIdx, dropIdx, startedAt } = runningSet;
    const endedAt = Date.now() + bonusSeconds * 1000;
    const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
    // Read from the render's blocks, not from inside the updater: React only
    // runs an updater eagerly when nothing else is queued on this screen, so
    // a value assigned in there was sometimes still unset when the rest began.
    const restSec = blocks[blockIdx]?.restSeconds ?? defaultRestSeconds;
    setBlocks(prev => prev.map((b, bi) => {
      if (bi !== blockIdx) return b;
      const completedSet = b.sets[setIdx];
      return {
        ...b,
        sets: b.sets.map((s, si) => {
          if (si === setIdx) {
            if (dropIdx !== undefined) {
              // Mark dropset complete with timing
              const newDrops = (s.drops ?? []).map((d, di) =>
                di === dropIdx ? { ...d, completed: true, time: String(seconds), startedAt, endedAt } : d
              );
              return { ...s, drops: newDrops };
            }
            return { ...s, time: String(seconds), startedAt, endedAt, completed: true };
          }
          if (dropIdx === undefined && si > setIdx && !s.completed) {
            return {
              ...s,
              weight: s.weight || completedSet.weight,
              reps: s.reps || completedSet.reps,
              rpe: s.rpe || completedSet.rpe,
            };
          }
          return s;
        }),
      };
    }));
    setRunningSet(null);
    startTimer({ type: 'set', blockIdx, setIdx, dropIdx }, restSec);
  }, [runningSet, startTimer, blocks, defaultRestSeconds]);

  // Helper: find first incomplete drop in a set
  const findIncompleteDrop = (set: SetRow): number | undefined => {
    if (!set.drops || set.drops.length === 0) return undefined;
    const idx = set.drops.findIndex(d => !d.completed);
    return idx === -1 ? undefined : idx;
  };

  // Helper: scan a single block for the next incomplete item starting at fromSetIdx.
  // For the just-completed set, only checks drops (the set itself is complete).
  // Returns { setIdx, dropIdx? } or null.
  const nextInBlock = (
    block: ExerciseBlock,
    fromSetIdx: number,
    onlyDropsForFirst = false
  ): { setIdx: number; dropIdx?: number } | null => {
    for (let si = fromSetIdx; si < block.sets.length; si++) {
      const s = block.sets[si];
      if (si === fromSetIdx && onlyDropsForFirst) {
        const di = findIncompleteDrop(s);
        if (di !== undefined) return { setIdx: si, dropIdx: di };
        continue;
      }
      if (!s.completed) return { setIdx: si };
      const di = findIncompleteDrop(s);
      if (di !== undefined) return { setIdx: si, dropIdx: di };
    }
    return null;
  };

  // Public: tap "Start next set" on an exercise header.
  const handleStartNextSet = useCallback((blockIdx: number) => {
    if (countdown) return;
    if (runningSet) return;
    const block = blocks[blockIdx];
    if (!block) return;

    const scrollToBlock = (target: number) => {
      if (target === blockIdx) return;
      // Defer to after countdown overlay renders
      setTimeout(() => {
        blockRefs.current[target]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    };

    const group = block.supersetGroup;

    // No superset → walk this block in order
    if (group === undefined) {
      const next = nextInBlock(block, 0);
      if (!next) {
        toast.success('All sets complete for this exercise');
        return;
      }
      setCountdown({ blockIdx, setIdx: next.setIdx, dropIdx: next.dropIdx });
      return;
    }

    // Superset group: ordered list of sibling block indices
    const siblingIdxs = blocks
      .map((b, i) => (b.supersetGroup === group ? i : -1))
      .filter(i => i !== -1);
    const myPos = siblingIdxs.indexOf(blockIdx);

    // Determine current set-number N (last completed set on current block, falls back to first incomplete-1)
    const lastCompletedSetIdx = (() => {
      for (let i = block.sets.length - 1; i >= 0; i--) {
        if (block.sets[i].completed) return i;
      }
      return -1;
    })();

    // Step 1: finish current set's dropsets on the just-completed block
    if (lastCompletedSetIdx >= 0) {
      const di = findIncompleteDrop(block.sets[lastCompletedSetIdx]);
      if (di !== undefined) {
        setCountdown({ blockIdx, setIdx: lastCompletedSetIdx, dropIdx: di });
        return;
      }
    }

    const N = lastCompletedSetIdx; // setIdx we just finished (incl. drops)

    // Step 2: same set-number N on remaining siblings (after current, in order)
    if (N >= 0) {
      for (let p = myPos + 1; p < siblingIdxs.length; p++) {
        const sbi = siblingIdxs[p];
        const sBlock = blocks[sbi];
        if (N >= sBlock.sets.length) continue;
        const s = sBlock.sets[N];
        if (!s.completed) {
          setCountdown({ blockIdx: sbi, setIdx: N });
          scrollToBlock(sbi);
          return;
        }
        const di = findIncompleteDrop(s);
        if (di !== undefined) {
          setCountdown({ blockIdx: sbi, setIdx: N, dropIdx: di });
          scrollToBlock(sbi);
          return;
        }
      }
    }

    // Step 3: advance to set N+1 — loop back to first sibling with incomplete N+1
    const nextN = N + 1;
    for (let p = 0; p < siblingIdxs.length; p++) {
      const sbi = siblingIdxs[p];
      const sBlock = blocks[sbi];
      if (nextN >= sBlock.sets.length) continue;
      const s = sBlock.sets[nextN];
      if (!s.completed) {
        setCountdown({ blockIdx: sbi, setIdx: nextN });
        scrollToBlock(sbi);
        return;
      }
      const di = findIncompleteDrop(s);
      if (di !== undefined) {
        setCountdown({ blockIdx: sbi, setIdx: nextN, dropIdx: di });
        scrollToBlock(sbi);
        return;
      }
    }

    // Step 4: no exact set-number progression match → final fallback: any incomplete in group
    for (const sbi of siblingIdxs) {
      const next = nextInBlock(blocks[sbi], 0);
      if (next) {
        setCountdown({ blockIdx: sbi, setIdx: next.setIdx, dropIdx: next.dropIdx });
        scrollToBlock(sbi);
        return;
      }
    }

    toast.success('All sets complete for this exercise');
  }, [blocks, countdown, runningSet]);

  // Public: tap "Stop set" on an exercise header. Stops the running set
  // without starting a new countdown or auto-advancing.
  const handleStopSetClick = useCallback(() => {
    if (!runningSet) return;
    stopRunningSet(0);
  }, [runningSet, stopRunningSet]);

  const handleCountdownComplete = useCallback(() => {
    if (!countdown) return;
    const { blockIdx, setIdx, dropIdx } = countdown;
    // Stop & record any active rest timer at the moment the new set begins.
    skipTimer();
    const startedAt = Date.now();
    if (dropIdx === undefined) {
      setBlocks(prev => prev.map((b, bi) =>
        bi !== blockIdx ? b : {
          ...b,
          sets: b.sets.map((s, si) => si === setIdx ? { ...s, startedAt, endedAt: undefined } : s),
        }
      ));
    }
    // Note: dropsets don't track their own startedAt/endedAt on SetRow.drops shape — only `completed`.
    setRunningSet({ blockIdx, setIdx, dropIdx, startedAt });
    setCountdown(null);
  }, [countdown, skipTimer]);

  // addSet, addDrop, updateDrop, removeSet, removeDrop, addExercise, addMultipleExercises, removeExercise
  // are provided by useBlockMutations hook

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 8 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex(b => b.exerciseId === active.id);
    const newIndex = blocks.findIndex(b => b.exerciseId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    setBlocks(prev => arrayMove(prev, oldIndex, newIndex));
    shiftBlockIndices(i => {
      if (i === oldIndex) return newIndex;
      if (oldIndex < newIndex && i > oldIndex && i <= newIndex) return i - 1;
      if (oldIndex > newIndex && i >= newIndex && i < oldIndex) return i + 1;
      return i;
    });
  }, [blocks, shiftBlockIndices]);

  // Register session controller for AI chat mutations. Not in edit mode: a
  // past workout registered as the live one gave the coach a fake
  // active_session, and its session tools then rewrote history — and because
  // the edit screen writes no cache either, editing a past workout stays
  // invisible to the coach through both doors.
  //
  // Unregistering on unmount is not the coach losing the workout: with no
  // screen mounted it falls back to the session cache (see `getSessionCache`
  // above), which is the same workout by another name.
  useEffect(() => {
    if (isEditMode) return;
    registerSession({
      // Each writer wraps setBlocks in flushSync so the functional updater
      // runs and commits before the outer function returns. Without flushSync,
      // React 18 batches the update inside the AI-chat Apply event handler;
      // the updater fires during the next render, so `added`/`found` are
      // still false when we return, and applyProposal mis-marks the proposal
      // as "rejected — already in workout" even though the exercise was added.
      addExercise: (exerciseId, sets = 3, targetReps, weight) => {
        let added = false;
        flushSync(() => {
          setBlocks(prev => {
            if (prev.some(b => b.exerciseId === exerciseId)) return prev;
            added = true;
            return [...prev, {
              exerciseId,
              exerciseName: exerciseLookup[exerciseId] ?? exerciseId,
              restSeconds: defaultRestSeconds,
              dropSetsEnabled: defaultDropSetsEnabled,
              sets: Array.from({ length: sets }, (_, i) => ({
                setNumber: i + 1,
                weight: weight?.toString() ?? '',
                reps: targetReps?.toString() ?? '',
                completed: false,
                type: 'normal' as SetType,
                rpe: '',
                time: '',
              })),
            }];
          });
        });
        return added;
      },
      addSets: (identifier, count) => {
        let found = false;
        flushSync(() => {
          setBlocks(prev => prev.map((block, idx) => {
            const match = block.exerciseName.toLowerCase() === identifier.toLowerCase()
              || idx.toString() === identifier;
            if (!match) return block;
            found = true;
            const lastSet = block.sets[block.sets.length - 1];
            const normalCount = block.sets.filter(s => s.type !== 'warmup').length;
            const newSets = Array.from({ length: count }, (_, i) => ({
              setNumber: normalCount + i + 1,
              weight: lastSet?.weight ?? '',
              reps: lastSet?.reps ?? '',
              completed: false,
              type: (lastSet?.type === 'warmup' ? 'normal' : lastSet?.type ?? 'normal') as SetType,
              rpe: '',
              time: '',
            }));
            return { ...block, sets: [...block.sets, ...newSets] };
          }));
        });
        return found;
      },
      updateSet: (exerciseName, setNumber, updates) => {
        let found = false;
        flushSync(() => {
          setBlocks(prev => prev.map(block => {
            if (block.exerciseName.toLowerCase() !== exerciseName.toLowerCase()) return block;
            return {
              ...block,
              sets: block.sets.map(set => {
                // Warm-ups are numbered 1..n on their own; "set 1" from the
                // coach means working set 1, not both.
                if (set.type === 'warmup' || set.setNumber !== setNumber) return set;
                found = true;
                return {
                  ...set,
                  ...(updates.weight !== undefined ? { weight: updates.weight.toString() } : {}),
                  ...(updates.reps !== undefined ? { reps: updates.reps.toString() } : {}),
                };
              }),
            };
          }));
        });
        return found;
      },
      swapExercise: (currentName, newExerciseId) => {
        let found = false;
        flushSync(() => {
          setBlocks(prev => prev.map(block => {
            if (block.exerciseName.toLowerCase() !== currentName.toLowerCase()) return block;
            found = true;
            return {
              ...block,
              exerciseId: newExerciseId,
              exerciseName: exerciseLookup[newExerciseId] ?? newExerciseId,
            };
          }));
        });
        return found;
      },
      getBlocks: () => blocks,
      getStartTime: () => startTime.current,
      getActiveRestTimer: () => {
        if (!activeTimer) return null;
        const now = Date.now();
        let elapsed: number;
        if (activeTimer.status === 'paused') {
          elapsed = activeTimer.elapsedAtPause ?? 0;
        } else if (activeTimer.status === 'running') {
          elapsed = Math.floor((now - activeTimer.startedAtEpoch) / 1000);
        } else {
          elapsed = activeTimer.originalDuration;
        }
        const cappedElapsed = Math.min(Math.max(0, elapsed), activeTimer.originalDuration);
        return {
          status: activeTimer.status,
          exerciseIndex: activeTimer.id.blockIdx,
          setIndex: activeTimer.id.setIdx,
          durationSeconds: activeTimer.duration,
          originalDurationSeconds: activeTimer.originalDuration,
          elapsedSeconds: cappedElapsed,
          remainingSeconds: Math.max(0, activeTimer.originalDuration - cappedElapsed),
        };
      },
    });
    return () => unregisterSession();
  }, [blocks, defaultDropSetsEnabled, defaultRestSeconds, activeTimer, exerciseLookup, isEditMode]);

  // toggleDropSets and addWarmupSet are provided by useBlockMutations hook

  const handleMenuAction = useCallback((action: string, blockIdx: number) => {
    const block = blocks[blockIdx];
    switch (action) {
      case 'Add Note':
        setNoteText(block.note ?? '');
        setEditingNote({ blockIdx, type: 'note' });
        break;
      case 'Add Sticky Note':
        setNoteText(getStickyNote(block.exerciseId));
        setEditingNote({ blockIdx, type: 'sticky' });
        break;
      case 'Create Superset':
        setShowSupersetLinker(true);
        break;
      case 'Drop Sets':
        toggleDropSets(blockIdx);
        break;
      case 'Add Warm-up Sets':
        addWarmupSet(blockIdx);
        break;
      case 'Remove Exercise':
        setPendingRemoveIdx(blockIdx);
        break;
      case 'Replace Exercise':
        setReplaceIdx(blockIdx);
        setShowExercisePicker(true);
        break;
      case 'Update Rest Timer':
        // The menu hides this while editing a past workout; this is the
        // backstop for any caller that does not pass isEditMode.
        if (isEditMode) break;
        setRestInput(String(block.restSeconds));
        setEditingRest({ exerciseId: block.exerciseId });
        break;
    }
  }, [blocks, getStickyNote, toggleDropSets, addWarmupSet, isEditMode]);

  const saveNote = useCallback(() => {
    if (!editingNote) return;
    const { blockIdx, type } = editingNote;
    if (type === 'note') {
      setBlocks(prev => prev.map((b, i) => i === blockIdx ? { ...b, note: noteText.trim() || undefined } : b));
    } else {
      setStickyNote(blocks[blockIdx].exerciseId, noteText);
    }
    setEditingNote(null);
  }, [editingNote, noteText, blocks, setStickyNote]);

  /**
   * The exercise's own rest, for the remainder of this session only — the
   * template is not touched here. A rest already running keeps the length it
   * was started with, because `startTimer` reads `restSeconds` at the moment
   * the rest begins and nothing re-reads it afterwards.
   */
  const saveRest = useCallback(() => {
    if (!editingRest) return;
    const seconds = Number(restInput.trim());
    if (!Number.isInteger(seconds) || seconds < MIN_REST_SECONDS || seconds > MAX_REST_SECONDS) {
      toast.error(`Rest must be a whole number of seconds from ${MIN_REST_SECONDS} to ${MAX_REST_SECONDS}.`);
      return;
    }
    const { exerciseId } = editingRest;
    // Addressed by id rather than by the index the dialog was opened at: a
    // coach proposal applying underneath the overlay can insert, remove or
    // reorder blocks, and every other position-keyed state here is remapped
    // for the same reason.
    setBlocks(prev => prev.map(b => b.exerciseId === exerciseId ? { ...b, restSeconds: seconds } : b));
    setEditingRest(null);
  }, [editingRest, restInput]);

  const handleSupersetSave = useCallback((groups: Record<string, number | undefined>) => {
    setBlocks(prev => prev.map(b => ({ ...b, supersetGroup: groups[b.exerciseId] })));
    setShowSupersetLinker(false);
  }, []);

  // The same question for both ways a workout can end: the ordinary Finish and
  // the "save it anyway" confirmation for a very short session, which used to
  // hand the session straight to onFinish and skip the template diff.
  const finishWithTemplateCheck = useCallback((finalSession: WorkoutSession) => {
    const shouldCheckTemplate =
      !isEditMode &&
      template &&
      onUpdateTemplate &&
      originalTemplateSnapshot.current;

    if (shouldCheckTemplate) {
      // A partner skipped outright leaves its group with one member, which is
      // no longer a superset — and writing it back would park a link the
      // template can never resolve.
      // Only working sets count: an exercise that got no further than its
      // warm-up is a skipped one, not a template entry of one warm-up set.
      // Unless the template entry is itself warm-up typed (the coach's tools
      // allow it): then its warm-up rows are the plan, done as planned.
      const isWorking = (b: ExerciseBlock, s: SetRow) =>
        s.completed && (s.type !== 'warmup'
          || originalTemplateSnapshot.current?.find(e => e.exerciseId === b.exerciseId)?.setType === 'warmup');
      const completedBlocks: FinishedBlockLite[] = withoutLoneSupersets(blocks
        .filter(b => b.sets.some(s => isWorking(b, s)))
        .map(b => {
          const completed = b.sets.filter(s => isWorking(b, s));
          const lastSet = completed[completed.length - 1];
          const lastReps = completed.length > 0 ? parseInt(lastSet.reps) || null : null;
          const setType = completed[0]?.type ?? b.sets[0]?.type ?? 'normal';
          const mode = getExerciseInputMode(b.exerciseId, customExercises);
          const lastWeight = usesWeight(mode)
            ? inputToTargetWeight(lastSet?.weight, weightUnit, mode === 'band')
            : undefined;
          return {
            exerciseId: b.exerciseId,
            completedSetCount: completed.length,
            lastReps,
            lastWeight,
            setType,
            supersetGroup: b.supersetGroup,
            restSeconds: b.restSeconds,
          };
        }));
      const afterSnapshot = snapshotFromFinishedBlocks(completedBlocks);
      const diff = diffTemplateSnapshots(originalTemplateSnapshot.current!, afterSnapshot);
      if (diff.hasChanges) {
        const updated = buildUpdatedTemplate(template!, completedBlocks);
        templateChoiceMade.current = false;
        setPendingFinishedSession(finalSession);
        setPendingTemplateUpdate({ template: updated, summary: diff.summary });
        return;
      }
    }

    onFinish(finalSession);
  }, [blocks, onFinish, isEditMode, weightUnit, customExercises, template, onUpdateTemplate]);

  const keepTemplate = useCallback(() => {
    if (templateChoiceMade.current) return;
    templateChoiceMade.current = true;
    const session = pendingFinishedSession;
    setPendingTemplateUpdate(null);
    setPendingFinishedSession(null);
    if (session) onFinish(session);
  }, [pendingFinishedSession, onFinish]);

  /**
   * Save the template, then finish. The save is awaited rather than fired and
   * forgotten: it can fail (a phone with no signal at the end of a workout is
   * the common case), and reporting success before the write was even
   * attempted is what made a lost update look like one that had landed.
   * `onUpdateTemplate` keeps the edit and retries it later, so a failure here
   * is reported, not silently dropped.
   */
  const acceptTemplateUpdate = useCallback(async () => {
    if (templateChoiceMade.current) return;
    templateChoiceMade.current = true;
    const session = pendingFinishedSession;
    const tplUpdate = pendingTemplateUpdate;
    setPendingTemplateUpdate(null);
    setPendingFinishedSession(null);
    if (session) onFinish(session);

    if (!tplUpdate || !onUpdateTemplate) return;
    try {
      const saved = await onUpdateTemplate(tplUpdate.template);
      if (saved !== false) toast.success('Template updated');
    } catch (e) {
      console.error('[ActiveSession] update template failed:', e);
      toast.error('Failed to update template');
    }
  }, [pendingFinishedSession, pendingTemplateUpdate, onFinish, onUpdateTemplate]);

  const finishWorkout = useCallback(() => {
    // Guard: require at least one completed set
    const hasCompletedSet = blocks.some(b => b.sets.some(s => s.completed));
    if (!hasCompletedSet) {
      toast.error('Complete at least one set or Discard this workout.');
      return;
    }

    // Guard: any completed set with invalid field values blocks finishing.
    // A drop is checked only under a completed parent, because those are the
    // only drops the log built below keeps.
    const invalidField = (row: { weight: string; reps: string; rpe: string }, mode: ExerciseInputMode) => {
      const errs = getSetFieldErrors(row, weightUnit, mode);
      return errs.weight ? 'weight' : errs.reps ? 'reps' : errs.rpe ? 'RPE' : null;
    };
    for (const block of blocks) {
      const mode = getExerciseInputMode(block.exerciseId, customExercises);
      for (const s of block.sets) {
        if (!s.completed) continue;
        const badField = invalidField(s, mode);
        if (badField) {
          toast.error(`Fix invalid ${badField} in ${block.exerciseName}, Set ${s.setNumber}`);
          return;
        }
        for (const [di, d] of (s.drops ?? []).entries()) {
          if (!d.completed) continue;
          const badDropField = invalidField(d, mode);
          if (badDropField) {
            toast.error(`Fix invalid ${badDropField} in ${block.exerciseName}, Set ${s.setNumber} drop ${di + 1}`);
            return;
          }
        }
      }
    }

    // A partner with nothing completed is left out of the log, so the one
    // that remains must not keep a group of its own — that reads as
    // "Superset A · 1 of 1" on the summary and in history for good.
    const exerciseLogs: ExerciseLog[] = withoutLoneSupersetGroups(normalizeBlocks(blocks)
      .filter(b => b.sets.some(s => s.completed))
      .map(b => {
        const mode = getExerciseInputMode(b.exerciseId, customExercises);
        const sets: WorkoutSet[] = [];
        b.sets.filter(s => s.completed).forEach(s => {
          const seconds = timeToSeconds(s.time);
          const distMeters = s.distance ? toMeters(parseFloat(s.distance) || 0, distanceUnit) : undefined;
          // The same input → storage rule a template target follows, so a band
          // level lands as the level and not as a converted "mass".
          const isBand = mode === 'band';
          sets.push({
            setNumber: s.setNumber,
            type: s.type,
            reps: isTimeBased(mode) && !usesReps(mode) ? 1 : (parseInt(s.reps) || 0),
            weight: usesWeight(mode) ? inputToTargetWeight(s.weight, weightUnit, isBand) : undefined,
            rpe: s.rpe ? parseFloat(s.rpe) : undefined,
            time: seconds > 0 ? seconds : (isTimeBased(mode) ? (parseInt(s.reps) || 0) : undefined),
            distance: distMeters && distMeters > 0 ? distMeters : undefined,
          });
          // Append completed dropsets immediately after their parent set
          (s.drops ?? []).filter(d => d.completed).forEach(d => {
            const dSeconds = d.time ? timeToSeconds(d.time) : 0;
            const dDistMeters = d.distance ? toMeters(parseFloat(d.distance) || 0, distanceUnit) : undefined;
            sets.push({
              setNumber: s.setNumber,
              type: 'dropset',
              reps: isTimeBased(mode) && !usesReps(mode) ? 1 : (parseInt(d.reps) || 0),
              weight: usesWeight(mode) ? inputToTargetWeight(d.weight, weightUnit, isBand) : undefined,
              rpe: d.rpe ? parseFloat(d.rpe) : undefined,
              time: dSeconds > 0 ? dSeconds : undefined,
              distance: dDistMeters && dDistMeters > 0 ? dDistMeters : undefined,
            });
          });
        });
        return {
          exerciseId: b.exerciseId,
          exerciseName: resolveExerciseName(exerciseLookup, b.exerciseId, b.exerciseName),
          supersetGroup: b.supersetGroup,
          sets,
          note: b.note?.trim() || undefined,
        };
      }));

    const allSets = exerciseLogs.flatMap(l => l.sets);
    const totalReps = allSets.reduce((s, set) => s + set.reps, 0);
    // A band's "weight" is a level from a picker, not kilograms, so it is left
    // out of volume rather than multiplied into it — level 3 is not 3 kg by any
    // reading, and before the level/kg mix-up was fixed the same set scored
    // differently for a kg user and an lbs user.
    const bandExerciseIds = new Set(
      exerciseLogs
        .filter(l => getExerciseInputMode(l.exerciseId, customExercises) === 'band')
        .map(l => l.exerciseId),
    );
    const totalVolume = exerciseLogs.reduce(
      (sum, log) => bandExerciseIds.has(log.exerciseId)
        ? sum
        : sum + log.sets.reduce((s, set) => s + set.reps * (set.weight ?? 0), 0),
      0,
    );
    const rpeSets = allSets.filter(s => s.rpe !== undefined && s.type !== 'warmup');
    const averageRpe = rpeSets.length > 0 ? rpeSets.reduce((s, set) => s + (set.rpe ?? 0), 0) / rpeSets.length : undefined;

    let sessionDate: string;
    let duration: number;
    let startedAt: string | undefined;

    if (isEditMode && editSession) {
      sessionDate = editDate || editSession.date.substring(0, 10);
      duration = editDurationMin && editDurationMin !== initialEditDurationMin.current
        ? parseInt(editDurationMin) * 60
        : editSession.duration;
      const startChanged = editDate !== initialEditDate.current || editTime !== initialEditTime.current;
      if (editTime && startChanged) {
        startedAt = new Date(`${sessionDate}T${editTime}:00`).toISOString();
      } else {
        startedAt = editSession.startedAt;
      }
    } else {
      // Filed under the day it started (a workout crossing midnight kept its
      // startedAt on one day and its date on the next), timed from the true
      // start, and with the pause excluded: `startTime` is the resume-shifted
      // anchor, so now − startTime is the active time, and while paused the
      // frozen figure is the answer.
      sessionDate = format(new Date(trueStart.current), 'yyyy-MM-dd');
      duration = timerPaused && pausedElapsed.current !== null
        ? pausedElapsed.current
        : Math.floor((Date.now() - startTime.current) / 1000);
      startedAt = new Date(trueStart.current).toISOString();
    }

    const finalSession: WorkoutSession = {
      id: isEditMode && editSession ? editSession.id : crypto.randomUUID(),
      date: sessionDate,
      startedAt,
      exercises: exerciseLogs,
      duration,
      totalVolume,
      totalSets: allSets.length,
      totalReps,
      averageRpe,
      note: workoutNote.trim() || undefined,
      location: location || undefined,
      // Fields the edit screen has no control for ride through unchanged;
      // dropping them turned an edited rest day into a plain empty workout.
      ...(isEditMode && editSession ? { isRestDay: editSession.isRestDay, recoveryActivities: editSession.recoveryActivities } : {}),
    };

    // Duration < 30s prompt — defer to an AlertDialog instead of the old
    // window.confirm(), which is suppressed by some mobile in-app WebViews
    // and returns false (silently blocking the save) on others.
    if (!isEditMode && duration < 30) {
      setPendingShortWorkout(finalSession);
      return;
    }

    finishWithTemplateCheck(finalSession);
  }, [blocks, finishWithTemplateCheck, isEditMode, editSession, editDate, editTime, editDurationMin, workoutNote, weightUnit, customExercises, exerciseLookup, timerPaused, location]);

  if (showSupersetLinker) {
    return (
      <SupersetLinker
        exercises={blocks.map(b => ({
          exerciseId: b.exerciseId,
          exerciseName: b.exerciseName,
          supersetGroup: b.supersetGroup,
        }))}
        onSave={handleSupersetSave}
        onCancel={() => setShowSupersetLinker(false)}
      />
    );
  }

  if (showExercisePicker) {
    const isReplaceMode = replaceIdx !== null;
    return (
      <div id="tutorial-exercise-picker-root" className="h-[100dvh] bg-background flex flex-col overflow-hidden min-w-0">
        <div className="p-4 pb-0 shrink-0">
          <Button variant="outline" onClick={() => { setShowExercisePicker(false); setPendingExerciseIds([]); setReplaceIdx(null); }} className="mb-2">← Back</Button>
        </div>
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <ExerciseSelector
            multiSelect={!isReplaceMode && !tutorialActive}
            onSelect={(id) => {
              if (isReplaceMode) {
                replaceExercise(replaceIdx!, id);
                setReplaceIdx(null);
              } else {
                setPendingExerciseIds([]);
                addExercise(id);
              }
              setShowExercisePicker(false);
            }}
            onSelectMultiple={isReplaceMode || tutorialActive ? undefined : (ids) => { setPendingExerciseIds([]); addMultipleExercises(ids); setShowExercisePicker(false); }}
            initialSelected={isReplaceMode ? [] : pendingExerciseIds}
            onSelectionChange={isReplaceMode ? undefined : setPendingExerciseIds}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        {isEditMode ? (
          <button
            onClick={() => (editHasChanges ? setShowDiscardEditsConfirm(true) : onCancel())}
            aria-label="Cancel editing"
            className="text-sm text-muted-foreground hover:text-foreground"
          >✕</button>
        ) : (
          <button onClick={onMinimize ?? onCancel} aria-label="Back" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* 3-dot menu */}
          <Popover>
            <PopoverTrigger asChild>
              <button aria-label="Workout options" className="text-muted-foreground hover:text-foreground p-1">
                <MoreVertical className="w-5 h-5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              <button
                onClick={() => setShowNoteDialog(true)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors text-foreground"
              >
                <FileText className="w-4 h-4" />
                {workoutNote ? 'Edit Note' : 'Add Note'}
              </button>
              {!isEditMode && (
                <button
                  onClick={() => { setHideTimers(prev => { const next = !prev; onUpdateHideTimers?.(next); return next; }); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-accent transition-colors text-foreground"
                >
                  <Timer className="w-4 h-4" />
                  {hideTimers ? 'Show Timers' : 'Hide Timers'}
                </button>
              )}
            </PopoverContent>
          </Popover>
          {!isEditMode && (
            <Button variant="outline" size="sm" onClick={() => setShowFocusMode(true)} className="border-primary/30 text-primary hover:bg-primary/10">
              <Focus className="w-3.5 h-3.5 mr-1" />
              Focus
            </Button>
          )}
          {!isEditMode && (
            <Button id="tutorial-discard-btn" variant="outline" size="sm" onClick={() => setShowDiscardConfirm(true)} className="text-destructive border-destructive/30 hover:bg-destructive/10">
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Discard
            </Button>
          )}
          <Button id="tutorial-finish-btn" variant="neon" size="sm" onClick={finishWorkout}>
            {isEditMode ? 'Save Changes' : 'Finish'}
          </Button>
        </div>
      </div>

      {/* Title + Timer */}
      <div className="px-4 pb-3">
        <input
          type="text"
          value={workoutName}
          onChange={e => setWorkoutName(e.target.value)}
          className="text-xl font-bold text-foreground bg-transparent outline-none border-b border-transparent focus:border-primary transition-colors w-full"
        />
        {/* Location selector */}
        <div className="relative mt-1">
          <button
            onClick={() => setShowLocationDropdown(!showLocationDropdown)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <MapPin className="w-3 h-3" />
            <span>{location}</span>
            <ChevronDown className="w-3 h-3" />
          </button>
          {showLocationDropdown && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg min-w-[180px] py-1">
              {locations.map(loc => (
                // A row is a select-button plus (for non-default locations) a
                // trash button. The old design gated onClick on a long-press
                // timer that only pointer events could set — keyboard users
                // hit Enter and nothing happened. Now onClick selects, and
                // delete is a distinct visible affordance.
                <div key={loc} className="flex items-stretch group">
                  <button
                    type="button"
                    onClick={() => { setLocation(loc); setShowLocationDropdown(false); }}
                    className={`flex-1 text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors ${loc === location ? 'text-primary font-medium' : 'text-foreground'}`}
                  >
                    {loc}
                  </button>
                  {loc !== DEFAULT_LOCATION && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDeleteLocationConfirm(loc); }}
                      aria-label={`Delete location ${loc}`}
                      className="px-2 text-muted-foreground/60 hover:text-destructive transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
              <div className="border-t border-border mt-1 pt-1 px-2 pb-1">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newLocationInput}
                    onChange={e => setNewLocationInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustomLocation()}
                    placeholder="Add location..."
                    className="flex-1 text-base bg-transparent outline-none text-foreground placeholder:text-muted-foreground px-1 py-1"
                  />
                  <button
                    onClick={addCustomLocation}
                    aria-label="Add location"
                    disabled={!newLocationInput.trim()}
                    className="text-primary hover:text-primary/80 disabled:opacity-30"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        {isEditMode ? (
          <div className="flex flex-wrap gap-3 mt-2">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Date</label>
              <input
                type="date"
                value={editDate}
                onChange={e => setEditDate(e.target.value)}
                className="bg-secondary/60 border border-border rounded-md px-2 py-1.5 text-base text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Time</label>
              <input
                type="time"
                value={editTime}
                onChange={e => setEditTime(e.target.value)}
                className="bg-secondary/60 border border-border rounded-md px-2 py-1.5 text-base text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration (min)</label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={editDurationMin}
                onChange={e => setEditDurationMin(e.target.value)}
                className="w-20 bg-secondary/60 border border-border rounded-md px-2 py-1.5 text-base text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 mt-2">
            <p className={`text-sm ${timerPaused ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>{formatTime(elapsedSeconds)}</p>
            <button
              onClick={toggleTimerPause}
              className="w-6 h-6 rounded-full flex items-center justify-center bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
              title={timerPaused ? 'Resume timer' : 'Pause timer'}
            >
              {timerPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
            </button>
          </div>
        )}
      </div>

      {/* Camera - hide in edit mode, collapsible */}
      {!isEditMode && (
        <Collapsible open={cameraOpen} onOpenChange={setCameraOpen}>
          <CollapsibleTrigger asChild>
            <button className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <span className="flex items-center gap-1.5">
                <Camera className="w-3.5 h-3.5" />
                Camera
              </span>
              <ChevronDown className={cn("w-4 h-4 transition-transform", cameraOpen && "rotate-180")} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="px-4 pb-4">
              <CameraFeed />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Note Editor Modal */}
      {editingNote && (
        // Above Focus Mode for the same reason as the rest dialog below: its
        // kebab menu offers Add Note from an opaque z-50 overlay, and an
        // equal level put this dialog behind it.
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {editingNote.type === 'sticky' ? '📌 Sticky Note' : '📝 Session Note'}
              </h3>
              <button onClick={() => setEditingNote(null)} aria-label="Close note editor" className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {editingNote.type === 'sticky'
                ? 'This note stays with this exercise across all future workouts.'
                : 'This note is only for this workout session.'}
            </p>
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="Type your note..."
              rows={3}
              className="w-full bg-secondary/60 border border-border rounded-lg p-3 text-base text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditingNote(null)}>Cancel</Button>
              <Button variant="neon" size="sm" onClick={saveNote}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Rest Length Editor Modal */}
      {editingRest && (
        // Above Focus Mode, which offers the same menu from an opaque z-50
        // overlay (its floating clone is z-[60]); at an equal level the
        // dialog opens underneath it and the tap reads as doing nothing.
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">⏱️ Rest Timer</h3>
              <button onClick={() => setEditingRest(null)} aria-label="Close rest timer editor" className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Rest between sets of {blocks.find(b => b.exerciseId === editingRest.exerciseId)?.exerciseName} for the rest of this workout. A rest already
              running keeps its countdown; this applies from the next one.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={MIN_REST_SECONDS}
                max={MAX_REST_SECONDS}
                step={5}
                aria-label="Rest seconds"
                value={restInput}
                onChange={e => setRestInput(e.target.value)}
                className="w-24 bg-secondary/60 border border-border rounded-lg p-2 text-base text-center text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
              <span className="text-xs text-muted-foreground">seconds ({MIN_REST_SECONDS}–{MAX_REST_SECONDS})</span>
            </div>
            <div className="flex gap-2">
              {REST_PRESETS.map(preset => (
                <button
                  key={preset}
                  onClick={() => setRestInput(String(preset))}
                  className="px-3 py-1 rounded-md bg-secondary/60 text-xs text-foreground hover:bg-secondary transition-colors"
                >
                  {preset}s
                </button>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditingRest(null)}>Cancel</Button>
              <Button variant="neon" size="sm" onClick={saveRest}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* Exercise Blocks */}
      <div className="flex-1 overflow-y-auto px-4 pb-44 space-y-2">
        <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={blocks.map(b => b.exerciseId)} strategy={verticalListSortingStrategy}>
            {blocks.map((block, blockIdx) => {
              const betweenId: TimerId = { type: 'between', blockIdx };
              const betweenKey = timerIdKey(betweenId);
              const isBetweenActive = activeTimer !== null && timerIdKey(activeTimer.id) === betweenKey;
              // You don't rest between the halves of a superset — you move to
              // the next one — and a rest bar wedged between them is the one
              // thing that stops a linked pair reading as linked.
              const withinSuperset = blockIdx > 0
                && block.supersetGroup !== undefined
                && blocks[blockIdx - 1].supersetGroup === block.supersetGroup;
              return (
              <React.Fragment key={block.exerciseId}>
                {!hideTimers && !isEditMode && blockIdx > 0 && !withinSuperset && (
                  <ExerciseRestTimer
                    timerId={betweenId}
                    defaultDuration={blocks[blockIdx - 1].restSeconds}
                    variant="between"
                    isActive={isBetweenActive}
                    remaining={isBetweenActive ? Math.ceil((activeTimer!.startedAtEpoch + activeTimer!.duration * 1000 - Date.now()) / 1000) : 0}
                    totalDuration={isBetweenActive ? activeTimer!.originalDuration : 0}
                    recordedRest={restRecords[betweenKey] ?? null}
                    onStart={startTimer}
                    onSkip={skipTimer}
                    onExtend={extendTimer}
                  />
                )}
                <div ref={el => { blockRefs.current[blockIdx] = el; }}>
                  <SortableExerciseItem id={block.exerciseId}>
                    <div className={`rounded-lg ${supersetInfo(blocks, blockIdx)?.colorClass ?? ''} ${block.supersetGroup !== undefined ? 'p-2' : ''}`}>
                      <ExerciseTable
                        block={block}
                        blockIdx={blockIdx}
                        weightUnit={weightUnit}
                        distanceUnit={distanceUnit}
                        blocks={blocks}
                        stickyNote={getStickyNote(block.exerciseId)}
                        activeTimer={activeTimer}
                        restRecords={restRecords}
                        previousSets={previousFor(block.exerciseId).sets}
                        previousDate={previousFor(block.exerciseId).date}
                        inputMode={getExerciseInputMode(block.exerciseId, customExercises)}
                        onUpdateSet={updateSet}
                        onToggleComplete={toggleSetComplete}
                        onAddSet={addSet}
                        onAddDrop={addDrop}
                        onUpdateDrop={updateDrop}
                        onRemoveSet={removeSet}
                        onRemoveDrop={removeDrop}
                        onMenuAction={handleMenuAction}
                        onStartTimer={startTimer}
                        onSkipTimer={skipTimer}
                        onExtendTimer={extendTimer}
                        onTitleTap={() => setDetailExerciseId(block.exerciseId)}
                        isEditMode={isEditMode}
                        // A record of a past workout has no rest to start; the
                        // bars would drive the live scheduler from edit mode.
                        hideTimers={hideTimers || isEditMode}
                        runningSet={runningSet}
                        onStartNextSet={handleStartNextSet}
                        onStopSet={handleStopSetClick}
                      />
                    </div>
                  </SortableExerciseItem>
                </div>
              </React.Fragment>
              );
            })}
          </SortableContext>
        </DndContext>

        {/* Add Exercise */}
        <button
          id="tutorial-add-exercise"
          onClick={() => setShowExercisePicker(true)}
          className="w-full py-3 rounded-lg border border-dashed border-muted-foreground/30 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Exercise
        </button>

        {blocks.length >= 2 && (
          <button
            onClick={() => setShowSupersetLinker(true)}
            className="w-full py-3 rounded-lg border border-dashed border-muted-foreground/30 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-2"
          >
            <Layers className="w-4 h-4" />
            Link Supersets
          </button>
        )}
      </div>

      {/* Focus Mode overlay */}
      {showFocusMode && !isEditMode && (
        <FocusMode
          blocks={blocks}
          weightUnit={weightUnit}
          activeTimer={activeTimer}
          restRecords={restRecords}
          runningSet={runningSet}
          getStickyNote={getStickyNote}
          getPrevious={previousFor}
          getInputMode={(exId) => getExerciseInputMode(exId, customExercises)}
          onUpdateSet={updateSet}
          onToggleComplete={toggleSetComplete}
          onAddSet={addSet}
          onAddDrop={addDrop}
          onUpdateDrop={updateDrop}
          onRemoveSet={removeSet}
          onRemoveDrop={removeDrop}
          onMenuAction={handleMenuAction}
          onStartTimer={startTimer}
          onSkipTimer={skipTimer}
          onExtendTimer={extendTimer}
          onStartNextSet={handleStartNextSet}
          onStopSet={handleStopSetClick}
          onClose={() => setShowFocusMode(false)}
        />
      )}

      {/* Workout note dialog */}
      <AlertDialog open={showNoteDialog} onOpenChange={setShowNoteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{workoutNote ? 'Edit Note' : 'Add Note'}</AlertDialogTitle>
            <AlertDialogDescription>
              Add a note to this workout session.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <textarea
            value={workoutNote}
            onChange={e => setWorkoutNote(e.target.value)}
            placeholder="How did this workout feel? Any observations..."
            className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground text-right">{workoutNote.length}/500</p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setShowNoteDialog(false)}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard confirmation — a plain yes/no, the same question the
          minimized bar asks. The dialog itself is the guard against a stray
          tap; making the user type a word on top of it only slowed down a
          decision they had already made. */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard Workout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to discard this workout? All progress will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowDiscardConfirm(false); onCancel(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Leaving an edit with unsaved changes — the same question the live
          workout's Discard asks, because the X in the corner sits where every
          other screen's back arrow does and used to throw the edit away on
          one tap with nothing kept. */}
      <AlertDialog open={showDiscardEditsConfirm} onOpenChange={setShowDiscardEditsConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to this workout have not been saved. Discard them and leave the record as it was?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setShowDiscardEditsConfirm(false); onCancel(); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Short-workout confirm (replaces window.confirm) */}
      <AlertDialog
        open={!!pendingShortWorkout}
        onOpenChange={(open) => { if (!open) setPendingShortWorkout(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save short workout?</AlertDialogTitle>
            <AlertDialogDescription>
              This workout was less than 30 seconds. Save it anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingShortWorkout(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const session = pendingShortWorkout;
                setPendingShortWorkout(null);
                if (session) finishWithTemplateCheck(session);
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Remove exercise confirmation */}
      <AlertDialog open={pendingRemoveIdx !== null} onOpenChange={open => { if (!open) setPendingRemoveIdx(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Exercise</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove {pendingRemoveIdx !== null ? blocks[pendingRemoveIdx]?.exerciseName : ''} from this workout? All sets will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRemoveIdx !== null) {
                  removeExercise(pendingRemoveIdx);
                  setPendingRemoveIdx(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete location confirmation */}
      <AlertDialog open={!!deleteLocationConfirm} onOpenChange={open => { if (!open) setDeleteLocationConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{deleteLocationConfirm}" from your saved locations?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteLocationConfirm) return;
                const updated = locations.filter(l => l !== deleteLocationConfirm);
                setLocations(updated);
                onUpdateCustomLocations?.(updated);
                if (location === deleteLocationConfirm) setLocation(DEFAULT_LOCATION);
                setDeleteLocationConfirm(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ExerciseDetailModal
        exerciseId={detailExerciseId}
        onClose={() => setDetailExerciseId(null)}
        history={history}
        weightUnit={weightUnit}
        stickyNotes={propStickyNotes}
        onUpdateStickyNotes={onUpdateStickyNotes}
      />

      {/* Update template prompt */}
      <AlertDialog
        open={!!pendingTemplateUpdate}
        onOpenChange={(open) => {
          // Radix also fires this as the dialog closes behind a button press,
          // and the state those handlers cleared is still set in this render's
          // closure — so without the ref guard a click finishes twice.
          if (!open && !templateChoiceMade.current && pendingFinishedSession) {
            // Treat dismiss (escape / back gesture) as "Keep template"
            keepTemplate();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update template?</AlertDialogTitle>
            <AlertDialogDescription>
              Your workout differs from <span className="font-semibold text-foreground">{template?.name}</span>.
              {pendingTemplateUpdate?.summary && (
                <span className="block mt-2 text-xs">{pendingTemplateUpdate.summary}</span>
              )}
              <span className="block mt-2">Update the template to match what you just did?</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={keepTemplate}>
              Keep template
            </AlertDialogCancel>
            <AlertDialogAction onClick={acceptTemplateUpdate}>
              Update template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 5-second countdown overlay before starting a timed set */}
      {countdown && (
        <CountdownOverlay
          from={5}
          onComplete={handleCountdownComplete}
          onCancel={() => setCountdown(null)}
        />
      )}
    </div>
  );
};