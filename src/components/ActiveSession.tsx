import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { ExerciseId, ExerciseLog, SetType, WorkoutSession, WorkoutSet, TemplateExercise } from '@/types/workout';
import { getExerciseInputMode, BAND_LEVELS, getBandLevelLabel, type ExerciseInputMode } from '@/utils/exerciseInputMode';
import { EXERCISES } from '@/types/workout';
import { toKg, fromKg } from '@/utils/weightConversion';
import { validateWeight, validateReps, validateRpe, canCompleteSet } from '@/utils/setValidation';
import { parseLocalDate } from '@/utils/dateUtils';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { CameraFeed } from '@/components/CameraFeed';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { SupersetLinker } from '@/components/SupersetLinker';
import { Button } from '@/components/ui/button';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { Check, Plus, MoreHorizontal, MoreVertical, StickyNote, FileText, Flame, Timer, RefreshCw, Layers, ChevronDown, Trash2, X, ArrowLeft, Pause, Play, MapPin } from 'lucide-react';
import { SwipeToDelete } from '@/components/SwipeToDelete';
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

const CACHE_KEY = 'active-session-cache';
const LOCATIONS_KEY = 'workout-locations';
const DEFAULT_LOCATION = 'Home Gym';

function getSavedLocations(): string[] {
  try {
    const raw = localStorage.getItem(LOCATIONS_KEY);
    if (!raw) return [DEFAULT_LOCATION];
    const parsed = JSON.parse(raw) as string[];
    return parsed.includes(DEFAULT_LOCATION) ? parsed : [DEFAULT_LOCATION, ...parsed];
  } catch {
    return [DEFAULT_LOCATION];
  }
}

function saveLocations(locations: string[]) {
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(locations));
}

export type TimerStatus = 'running' | 'paused' | 'completed';

export interface PersistedTimer {
  id: TimerId;
  startedAtEpoch: number;       // Date.now() when (re)started; 0 when paused
  duration: number;             // seconds remaining when this run started
  originalDuration: number;     // for progress ring math / extend baseline
  status: TimerStatus;
  elapsedAtPause?: number;      // seconds elapsed before pause
}

export interface ActiveSessionCache {
  blocks: ExerciseBlock[];
  workoutName: string;
  startTimestamp: number;
  elapsedAtCache: number;
  location?: string;
  workoutNote?: string;
  activeTimer?: PersistedTimer | null;
  restRecords?: Record<string, number>;
  runningSet?: RunningSetState | null;
}

// Safe localStorage write — never throws
function safeWriteCache(cache: ActiveSessionCache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('[ActiveSession] Failed to write cache:', e);
  }
}

export function clearSessionCache() {
  localStorage.removeItem(CACHE_KEY);
}

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
  templateName?: string;
  templateId?: string;
  template?: WorkoutTemplate | null;
  history?: WorkoutSession[];
  weightUnit?: WeightUnit;
  defaultDropSetsEnabled?: boolean;
  cachedSession?: ActiveSessionCache | null;
  /** When editing an existing session */
  editSession?: WorkoutSession | null;
  onFinish: (session: WorkoutSession) => void;
  onCancel: () => void;
  onMinimize?: () => void;
  onUpdateTemplate?: (template: WorkoutTemplate) => void;
}

/** Look up the most recent session data for a given exercise */
function getPreviousExerciseData(history: WorkoutSession[], exerciseId: ExerciseId): { weight?: number; reps: number; rpe?: number; time?: number }[] {
  for (const session of history) {
    const log = session.exercises.find(e => e.exerciseId === exerciseId);
    if (log && log.sets.length > 0) {
      return log.sets.map(s => ({ weight: s.weight, reps: s.reps, rpe: s.rpe, time: s.time }));
    }
  }
  return [];
}

interface DropRow {
  weight: string;
  reps: string;
  rpe: string;
  completed: boolean;
  time?: string;
  startedAt?: number;
  endedAt?: number;
}

interface SetRow {
  setNumber: number;
  weight: string;
  reps: string;
  completed: boolean;
  type: SetType;
  rpe: string;
  time: string;          // total seconds (string), formatted as mm:ss for display
  startedAt?: number;    // epoch ms — when "Start next set" countdown completed
  endedAt?: number;      // epoch ms — when "Stop set" was tapped
  drops?: DropRow[];
}

export interface RunningSetState {
  blockIdx: number;
  setIdx: number;
  dropIdx?: number;
  startedAt: number;
}

interface ExerciseBlock {
  exerciseId: ExerciseId;
  exerciseName: string;
  sets: SetRow[];
  note?: string; // session-only note
  supersetGroup?: number;
  restSeconds: number;
  dropSetsEnabled?: boolean;
}

const SUPERSET_COLORS = [
  'bg-red-500/20',
  'bg-blue-500/20',
  'bg-green-500/20',
  'bg-yellow-500/20',
  'bg-pink-500/20',
  'bg-orange-500/20',
  'bg-amber-800/20',
  'bg-purple-500/20',
  'bg-white/20',
];

const timerIdKey = (id: TimerId) => `${id.type}-${id.blockIdx}-${id.setIdx ?? ''}-${id.dropIdx ?? ''}`;

/**
 * Normalize blocks restored from cache or built from saved sessions:
 * - Parent rows in `block.sets` must never be `type: 'dropset'`.
 *   If found (legacy buggy state), coerce to 'superset' (when block is in
 *   a superset group) or 'normal'.
 * - `drops` remains the only source of nested dropsets.
 */
function normalizeBlocks(blocks: ExerciseBlock[]): ExerciseBlock[] {
  return blocks.map(b => {
    const fallback: SetType = b.supersetGroup !== undefined ? 'superset' : 'normal';
    let needsFix = false;
    const sets = b.sets.map(s => {
      if (s.type === 'dropset') {
        needsFix = true;
        return { ...s, type: fallback };
      }
      return s;
    });
    return needsFix ? { ...b, sets } : b;
  });
}

export const ActiveSession: React.FC<ActiveSessionProps> = ({ exercises: initialExercises, templateExercises, templateName, templateId, template, history = [], weightUnit = 'kg', defaultDropSetsEnabled = false, cachedSession, editSession, onFinish, onCancel, onMinimize, onUpdateTemplate }) => {
  const isEditMode = !!editSession;
  const { exercises: customExercises } = useCustomExercisesContext();
  const exerciseLookup = useMemo(() => {
    const lookup: Record<string, string> = {};
    for (const [id, ex] of Object.entries(EXERCISES)) {
      lookup[id] = ex.name;
    }
    for (const ce of customExercises) {
      lookup[ce.id] = ce.name;
    }
    return lookup;
  }, [customExercises]);
  // Convert saved session exercises back to blocks for editing.
  // Rebuilds nested `drops` from flat saved WorkoutSet[] (consecutive 'dropset'
  // rows attach to the most recent non-dropset parent of the same setNumber).
  const editBlocks = useMemo<ExerciseBlock[] | null>(() => {
    if (!editSession) return null;
    return editSession.exercises.map(ex => {
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

      const rows: SetRow[] = [];
      for (const s of repaired) {
        if (s.type === 'dropset' && rows.length > 0) {
          const parent = rows[rows.length - 1];
          parent.drops = parent.drops ?? [];
          parent.drops.push({
            weight: s.weight != null ? String(fromKg(s.weight, weightUnit)) : '',
            reps: s.reps.toString(),
            rpe: s.rpe?.toString() ?? '',
            completed: true,
            time: s.time != null ? String(s.time) : '',
          });
        } else {
          rows.push({
            setNumber: s.setNumber,
            weight: s.weight != null ? String(fromKg(s.weight, weightUnit)) : '',
            reps: s.reps.toString(),
            completed: true,
            type: s.type,
            rpe: s.rpe?.toString() ?? '',
            time: s.time != null ? String(s.time) : '',
          });
        }
      }
      return {
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        restSeconds: 90,
        supersetGroup: ex.supersetGroup,
        sets: rows,
        dropSetsEnabled: rows.some(r => (r.drops?.length ?? 0) > 0),
      };
    });
  }, [editSession, weightUnit]);

  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() => {
    if (editBlocks) return normalizeBlocks(editBlocks);
    if (cachedSession) return normalizeBlocks(cachedSession.blocks);
    return initialExercises.map((id, idx) => {
      const tpl = templateExercises?.[idx];
      const numSets = tpl?.sets ?? 3;
      const restSec = tpl?.restSeconds ?? 90;
      return {
        exerciseId: id,
        exerciseName: exerciseLookup[id] ?? id,
        restSeconds: restSec,
        dropSetsEnabled: defaultDropSetsEnabled,
        sets: Array.from({ length: numSets }, (_, i) => ({
          setNumber: i + 1,
          weight: '',
          reps: tpl?.targetReps === 'failure' ? '' : (tpl?.targetReps?.toString() ?? ''),
          completed: false,
          type: tpl?.setType ?? 'normal',
          rpe: '',
          time: '',
        })),
      };
    });
  });
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
  const [location, setLocation] = useState(cachedSession?.location ?? DEFAULT_LOCATION);
  const [locations, setLocations] = useState<string[]>(getSavedLocations);
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [newLocationInput, setNewLocationInput] = useState('');
  const [deleteLocationConfirm, setDeleteLocationConfirm] = useState<string | null>(null);
  const [pendingRemoveIdx, setPendingRemoveIdx] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [showSupersetLinker, setShowSupersetLinker] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(cachedSession?.elapsedAtCache ?? (editSession?.duration ?? 0));
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [detailExerciseId, setDetailExerciseId] = useState<ExerciseId | null>(null);
  const [timerPaused, setTimerPaused] = useState(false);
  const startTime = useRef(cachedSession ? (Date.now() - (cachedSession.elapsedAtCache * 1000)) : Date.now());
  const pausedElapsed = useRef<number | null>(null);
  const { getStickyNote, setStickyNote } = useStickyNotes();

  // Snapshot the original template structure (only when launched from a template, not edit mode, not resumed-from-cache)
  const originalTemplateSnapshot = useRef<TemplateSnapshot | null>(
    !isEditMode && !cachedSession && templateExercises && templateId
      ? snapshotFromTemplateExercises(templateExercises)
      : null
  );

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
    const d = parseLocalDate(editSession.date);
    return format(d, 'HH:mm');
  });
  const [editDurationMin, setEditDurationMin] = useState(() => {
    if (!editSession) return '';
    return Math.floor(editSession.duration / 60).toString();
  });

  // Cache session state to localStorage on changes (skip in edit mode)
  // NOTE: this effect is updated below to also persist activeTimer + restRecords
  // (see the dedicated cache-write effect after the timer state declarations).

  const addCustomLocation = useCallback(() => {
    const trimmed = newLocationInput.trim();
    if (trimmed && !locations.includes(trimmed)) {
      const updated = [...locations, trimmed];
      setLocations(updated);
      saveLocations(updated);
    }
    setLocation(trimmed || location);
    setNewLocationInput('');
    setShowLocationDropdown(false);
  }, [newLocationInput, locations, location]);

  // ============= Persistent timestamp-based rest timer =============
  // Source of truth = persisted record. setInterval below only triggers re-render.
  const [activeTimer, setActiveTimer] = useState<PersistedTimer | null>(
    cachedSession?.activeTimer ?? null
  );
  const [restRecords, setRestRecords] = useState<Record<string, number>>(
    cachedSession?.restRecords ?? {}
  );
  const [, setTimerTick] = useState(0); // forces re-render every ~1s while running
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const notificationTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completedFiredFor = useRef<Set<string>>(new Set());

  // Per-set live timing state (5s countdown -> running)
  const [countdown, setCountdown] = useState<{ blockIdx: number; setIdx: number; dropIdx?: number } | null>(null);
  const [runningSet, setRunningSet] = useState<RunningSetState | null>(
    cachedSession?.runningSet ?? null
  );
  const blockRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Cache full session state (including timer) to localStorage on changes (skip in edit mode)
  useEffect(() => {
    if (isEditMode) return;
    safeWriteCache({
      blocks,
      workoutName,
      startTimestamp: startTime.current,
      elapsedAtCache: elapsedSeconds,
      location,
      workoutNote: workoutNote || undefined,
      activeTimer,
      restRecords,
      runningSet,
    });
  }, [blocks, workoutName, elapsedSeconds, isEditMode, location, workoutNote, activeTimer, restRecords, runningSet]);

  // Derive remaining seconds from the persisted record. Allowed to go NEGATIVE
  // once the timer passes 0 — the rest timer keeps counting into "overtime"
  // until the user explicitly starts the next set or skips.
  const computeRemaining = useCallback((t: PersistedTimer | null): number => {
    if (!t) return 0;
    if (t.status === 'paused') {
      return t.originalDuration - (t.elapsedAtPause ?? 0);
    }
    if (t.status !== 'running' || !t.startedAtEpoch) return 0;
    const target = t.startedAtEpoch + t.duration * 1000;
    const remainingMs = target - Date.now();
    // Negative values are intentional (overtime). Cap upper bound at originalDuration.
    return Math.min(t.originalDuration, Math.ceil(remainingMs / 1000));
  }, []);

  // ---- Web Notification helpers (graceful no-op when unavailable) ----
  // For true app-killed delivery on native, @capacitor/local-notifications is required.
  const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window;

  const ensureNotificationPermission = useCallback(async () => {
    if (!notificationsSupported) return false;
    try {
      if (Notification.permission === 'granted') return true;
      if (Notification.permission === 'denied') return false;
      const res = await Notification.requestPermission();
      return res === 'granted';
    } catch {
      return false;
    }
  }, [notificationsSupported]);

  const cancelNotification = useCallback(() => {
    if (notificationTimeout.current) {
      clearTimeout(notificationTimeout.current);
      notificationTimeout.current = null;
    }
  }, []);

  const fireRestCompleteNotification = useCallback((late: boolean = false) => {
    try {
      if (notificationsSupported && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        new Notification('Rest complete', {
          body: late ? 'Your rest finished while you were away.' : 'Time for your next set.',
          tag: 'rest-timer',
          silent: false,
        });
      }
    } catch (e) {
      console.warn('[ActiveSession] Notification failed:', e);
    }
    toast.success(late ? 'Rest finished' : 'Rest complete', {
      description: late ? 'Your rest finished while you were away.' : 'Time for your next set.',
    });
  }, [notificationsSupported]);

  const scheduleNotification = useCallback((msUntil: number) => {
    cancelNotification();
    if (msUntil <= 0) return;
    notificationTimeout.current = setTimeout(() => {
      fireRestCompleteNotification(false);
    }, msUntil);
  }, [cancelNotification, fireRestCompleteNotification]);

  // ---- Reconcile / recalc on every relevant trigger ----
  // Timer NO LONGER auto-completes at 0 — it keeps ticking into negative
  // (overtime) until the user starts the next set or taps Skip. We still fire
  // the "rest complete" notification once when the threshold is first crossed.
  const recalcRestTimer = useCallback(() => {
    setActiveTimer(prev => {
      if (!prev) return prev;
      if (prev.status !== 'running') return prev;
      const remaining = computeRemaining(prev);
      const key = `${timerIdKey(prev.id)}@${prev.startedAtEpoch}`;
      if (remaining <= 0 && !completedFiredFor.current.has(key)) {
        completedFiredFor.current.add(key);
        const target = prev.startedAtEpoch + prev.duration * 1000;
        const wasLate = Date.now() - target > 1500;
        if (wasLate) fireRestCompleteNotification(true);
        cancelNotification();
      }
      // Force re-render so derived UI updates (countdown + overtime)
      setTimerTick(n => (n + 1) % 1000000);
      return prev;
    });
  }, [computeRemaining, cancelNotification, fireRestCompleteNotification]);

  // ---- Public timer controls ----
  const startTimer = useCallback((id: TimerId, duration: number) => {
    cancelNotification();
    // If a previous timer was running, record actual elapsed (incl. overtime)
    setActiveTimer(prev => {
      if (prev && prev.status === 'running') {
        const taken = prev.originalDuration - computeRemaining(prev);
        setRestRecords(r => ({ ...r, [timerIdKey(prev.id)]: Math.max(0, Math.round(taken)) }));
      }
      return null;
    });
    const now = Date.now();
    const newTimer: PersistedTimer = {
      id,
      startedAtEpoch: now,
      duration,
      originalDuration: duration,
      status: 'running',
    };
    setActiveTimer(newTimer);
    // Schedule notification + ask permission lazily
    ensureNotificationPermission().finally(() => {
      scheduleNotification(duration * 1000);
    });
  }, [cancelNotification, computeRemaining, ensureNotificationPermission, scheduleNotification]);

  const skipTimer = useCallback(() => {
    cancelNotification();
    setActiveTimer(prev => {
      if (prev) {
        const taken = prev.status === 'paused'
          ? (prev.elapsedAtPause ?? 0)
          : prev.originalDuration - computeRemaining(prev);
        setRestRecords(r => ({ ...r, [timerIdKey(prev.id)]: Math.max(0, Math.round(taken)) }));
      }
      return null;
    });
  }, [cancelNotification, computeRemaining]);

  const extendTimer = useCallback((delta: number = 30) => {
    setActiveTimer(prev => {
      if (!prev) return prev;
      const newOriginal = Math.max(1, prev.originalDuration + delta);
      let next: PersistedTimer;
      if (prev.status === 'running') {
        const remaining = computeRemaining(prev);
        const newRemaining = Math.max(1, remaining + delta);
        const now = Date.now();
        next = {
          ...prev,
          originalDuration: newOriginal,
          duration: newRemaining,
          startedAtEpoch: now,
          status: 'running',
        };
        cancelNotification();
        scheduleNotification(newRemaining * 1000);
      } else {
        next = { ...prev, originalDuration: newOriginal };
      }
      return next;
    });
  }, [computeRemaining, cancelNotification, scheduleNotification]);

  // Pause / resume — exposed for future UI; logic ready now.
  const pauseTimer = useCallback(() => {
    cancelNotification();
    setActiveTimer(prev => {
      if (!prev || prev.status !== 'running') return prev;
      const remaining = computeRemaining(prev);
      const elapsedAtPause = prev.originalDuration - remaining;
      return {
        ...prev,
        status: 'paused',
        startedAtEpoch: 0,
        elapsedAtPause: Math.max(0, elapsedAtPause),
      };
    });
  }, [cancelNotification, computeRemaining]);

  const resumeTimer = useCallback(() => {
    setActiveTimer(prev => {
      if (!prev || prev.status !== 'paused') return prev;
      const elapsed = prev.elapsedAtPause ?? 0;
      const newDuration = Math.max(1, prev.originalDuration - elapsed);
      const now = Date.now();
      ensureNotificationPermission().finally(() => scheduleNotification(newDuration * 1000));
      return {
        ...prev,
        status: 'running',
        startedAtEpoch: now,
        duration: newDuration,
        elapsedAtPause: undefined,
      };
    });
  }, [ensureNotificationPermission, scheduleNotification]);

  // ---- Hydrate on mount: reconcile if running timer expired while away ----
  useEffect(() => {
    const t = cachedSession?.activeTimer;
    if (!t || t.status !== 'running') return;
    const remaining = computeRemaining(t);
    if (remaining <= 0) {
      // Completed while app was closed
      const key = `${timerIdKey(t.id)}@${t.startedAtEpoch}`;
      completedFiredFor.current.add(key);
      setRestRecords(r => ({ ...r, [timerIdKey(t.id)]: t.originalDuration }));
      setActiveTimer(null);
      fireRestCompleteNotification(true);
    } else {
      // Resume: reschedule notification for remaining time
      ensureNotificationPermission().finally(() => scheduleNotification(remaining * 1000));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Tick interval — UI refresh only ----
  useEffect(() => {
    if (timerInterval.current) clearInterval(timerInterval.current);
    if (activeTimer && activeTimer.status === 'running') {
      timerInterval.current = setInterval(recalcRestTimer, 1000);
      // Immediate recalc in case >1s passed since last update
      recalcRestTimer();
    }
    return () => { if (timerInterval.current) clearInterval(timerInterval.current); };
  }, [activeTimer?.id.type, activeTimer?.id.blockIdx, activeTimer?.id.setIdx, activeTimer?.status, activeTimer?.startedAtEpoch, recalcRestTimer]);

  // ---- Visibility / focus / cross-tab listeners ----
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') recalcRestTimer();
    };
    const onFocus = () => recalcRestTimer();
    const onStorage = (e: StorageEvent) => {
      if (e.key !== CACHE_KEY || !e.newValue) return;
      try {
        const parsed: ActiveSessionCache = JSON.parse(e.newValue);
        if (parsed.activeTimer !== undefined) {
          setActiveTimer(parsed.activeTimer ?? null);
        }
        if (parsed.restRecords) {
          setRestRecords(parsed.restRecords);
        }
      } catch {
        // ignore malformed
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
    };
  }, [recalcRestTimer]);

  // Cleanup notification timeout on unmount
  useEffect(() => () => cancelNotification(), [cancelNotification]);


  // Note editing state
  const [editingNote, setEditingNote] = useState<{ blockIdx: number; type: 'note' | 'sticky' } | null>(null);
  const [noteText, setNoteText] = useState('');

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

  const updateSet = useCallback((blockIdx: number, setIdx: number, field: keyof SetRow, value: string | boolean | number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      const currentSet = block.sets[setIdx];
      const shouldCascade = (field === 'weight' || field === 'reps') && typeof value === 'string' && value !== '' && currentSet.type !== 'warmup';
      const oldValue = shouldCascade ? currentSet[field] : null;
      return {
        ...block,
        sets: block.sets.map((set, si) => {
          if (si === setIdx) return { ...set, [field]: value };
          // Cascade: update fields below that are blank or still hold the previous cascaded value
          if (shouldCascade && si > setIdx && set.type !== 'warmup' && (set[field] === '' || set[field] === oldValue)) {
            return { ...set, [field]: value };
          }
          return set;
        }),
      };
    }));
  }, []);

  const toggleSetComplete = useCallback((blockIdx: number, setIdx: number) => {
    setBlocks(prev => {
      const block = prev[blockIdx];
      const set = block.sets[setIdx];
      const wasCompleted = set.completed;

      // If trying to complete, validate first
      if (!wasCompleted) {
        const mode = getExerciseInputMode(block.exerciseId, customExercises);
        const isBodyweight = block.exerciseName.toLowerCase().includes('bodyweight') || (EXERCISES[block.exerciseId]?.name ?? '').toLowerCase().includes('bodyweight');
        if (!canCompleteSet(set.weight, set.reps, weightUnit, isBodyweight, mode === 'cardio')) {
          toast.error('Enter valid weight and reps before completing this set.');
          return prev;
        }
      }

      const updated = prev.map((b, bi) => {
        if (bi !== blockIdx) return b;
        const completedSet = b.sets[setIdx];
        return {
          ...b,
          sets: b.sets.map((s, si) => {
            if (si === setIdx) return { ...s, completed: !s.completed };
            // Auto-fill subsequent empty sets when completing (not uncompleting)
            if (!wasCompleted && si > setIdx && !s.completed) {
              return {
                ...s,
                weight: s.weight || completedSet.weight,
                reps: s.reps || completedSet.reps,
                rpe: s.rpe || completedSet.rpe,
                time: s.time || completedSet.time,
              };
            }
            return s;
          }),
        };
      });
      if (!wasCompleted) {
        startTimer({ type: 'set', blockIdx, setIdx }, block.restSeconds);
      }
      return updated;
    });
  }, [startTimer, weightUnit, customExercises]);

  // Internal: stop a running set (or dropset), write its duration into time, mark complete, start rest timer.
  // bonusSeconds is added when the user starts a NEW set while one is still running (per spec: +5s).
  const stopRunningSet = useCallback((bonusSeconds: number = 0) => {
    if (!runningSet) return;
    const { blockIdx, setIdx, dropIdx, startedAt } = runningSet;
    const endedAt = Date.now() + bonusSeconds * 1000;
    const seconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
    let restSec = 90;
    setBlocks(prev => prev.map((b, bi) => {
      if (bi !== blockIdx) return b;
      restSec = b.restSeconds;
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
  }, [runningSet, startTimer]);

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

  const addSet = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      const lastSet = block.sets[block.sets.length - 1];
      const normalCount = block.sets.filter(s => s.type !== 'warmup').length;
      return {
        ...block,
        sets: [...block.sets, {
          setNumber: normalCount + 1,
          weight: lastSet?.weight ?? '',
          reps: lastSet?.reps ?? '',
          completed: false,
          type: lastSet?.type === 'warmup' ? 'normal' : (lastSet?.type ?? 'normal'),
          rpe: '',
          time: '',
        }],
      };
    }));
  }, []);

  const addDrop = useCallback((blockIdx: number, setIdx: number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      return {
        ...block,
        sets: block.sets.map((set, si) => {
          if (si !== setIdx) return set;
          const drops = set.drops ?? [];
          return { ...set, drops: [...drops, { weight: '', reps: '', rpe: '', completed: false }] };
        }),
      };
    }));
  }, []);

  const updateDrop = useCallback((blockIdx: number, setIdx: number, dropIdx: number, field: keyof DropRow, value: string | boolean) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      return {
        ...block,
        sets: block.sets.map((set, si) => {
          if (si !== setIdx || !set.drops) return set;
          return { ...set, drops: set.drops.map((d, di) => di === dropIdx ? { ...d, [field]: value } : d) };
        }),
      };
    }));
  }, []);

  const removeSet = useCallback((blockIdx: number, setIdx: number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      const newSets = block.sets.filter((_, si) => si !== setIdx);
      let warmupCount = 0;
      let normalCount = 0;
      const renumbered = newSets.map(s => {
        if (s.type === 'warmup') {
          warmupCount++;
          return { ...s, setNumber: warmupCount };
        }
        normalCount++;
        return { ...s, setNumber: normalCount };
      });
      return { ...block, sets: renumbered };
    }));
  }, []);

  const removeDrop = useCallback((blockIdx: number, setIdx: number, dropIdx: number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      return {
        ...block,
        sets: block.sets.map((set, si) => {
          if (si !== setIdx || !set.drops) return set;
          const newDrops = set.drops.filter((_, di) => di !== dropIdx);
          return { ...set, drops: newDrops.length > 0 ? newDrops : undefined };
        }),
      };
    }));
  }, []);

  const addExercise = useCallback((id: ExerciseId) => {
    addMultipleExercises([id]);
  }, []);

  const addMultipleExercises = useCallback((ids: ExerciseId[]) => {
    setBlocks(prev => {
      const existingIds = new Set(prev.map(b => b.exerciseId));
      const newBlocks = ids
        .filter(id => !existingIds.has(id))
        .map(id => ({
          exerciseId: id,
          exerciseName: exerciseLookup[id] ?? id,
          restSeconds: 90,
          dropSetsEnabled: defaultDropSetsEnabled,
          sets: Array.from({ length: 3 }, (_, i) => ({
            setNumber: i + 1,
            weight: '',
            reps: '',
            completed: false,
            type: 'normal' as SetType,
            rpe: '',
            time: '',
          })),
        }));
      return [...prev, ...newBlocks];
    });
    setShowExercisePicker(false);
  }, [defaultDropSetsEnabled]);

  const removeExercise = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.filter((_, i) => i !== blockIdx));
  }, []);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 8 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setBlocks(prev => {
      const oldIndex = prev.findIndex(b => b.exerciseId === active.id);
      const newIndex = prev.findIndex(b => b.exerciseId === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  // Register session controller for AI chat mutations
  useEffect(() => {
    registerSession({
      addExercise: (exerciseId, sets = 3, targetReps, weight) => {
        let added = false;
        setBlocks(prev => {
          if (prev.some(b => b.exerciseId === exerciseId)) return prev;
          added = true;
          return [...prev, {
            exerciseId,
            exerciseName: exerciseLookup[exerciseId] ?? exerciseId,
            restSeconds: 90,
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
        return added;
      },
      addSets: (identifier, count) => {
        let found = false;
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
        return found;
      },
      updateSet: (exerciseName, setNumber, updates) => {
        let found = false;
        setBlocks(prev => prev.map(block => {
          if (block.exerciseName.toLowerCase() !== exerciseName.toLowerCase()) return block;
          return {
            ...block,
            sets: block.sets.map(set => {
              if (set.setNumber !== setNumber) return set;
              found = true;
              return {
                ...set,
                ...(updates.weight !== undefined ? { weight: updates.weight.toString() } : {}),
                ...(updates.reps !== undefined ? { reps: updates.reps.toString() } : {}),
              };
            }),
          };
        }));
        return found;
      },
      swapExercise: (currentName, newExerciseId) => {
        let found = false;
        setBlocks(prev => prev.map(block => {
          if (block.exerciseName.toLowerCase() !== currentName.toLowerCase()) return block;
          found = true;
          return {
            ...block,
            exerciseId: newExerciseId,
            exerciseName: exerciseLookup[newExerciseId] ?? newExerciseId,
          };
        }));
        return found;
      },
      getBlocks: () => blocks,
    });
    return () => unregisterSession();
  }, [blocks, defaultDropSetsEnabled]);

  const toggleDropSets = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.map((b, i) => {
      if (i !== blockIdx) return b;
      const nowEnabled = !b.dropSetsEnabled;
      // If disabling, remove all drops from sets
      if (!nowEnabled) {
        return {
          ...b,
          dropSetsEnabled: false,
          sets: b.sets.map(s => ({ ...s, drops: undefined })),
        };
      }
      return { ...b, dropSetsEnabled: true };
    }));
  }, []);

  const addWarmupSet = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      const warmupSet: SetRow = {
        setNumber: 0,
        weight: '',
        reps: '',
        completed: false,
        type: 'warmup' as SetType,
        rpe: '',
        time: '',
      };
      const newSets = [warmupSet, ...block.sets].map((s, i) => ({
        ...s,
        setNumber: s.type === 'warmup' ? 0 : i,
      }));
      // Re-number: warm-ups get "W1, W2..." and normals get "1, 2..."
      let warmupCount = 0;
      let normalCount = 0;
      const renumbered = newSets.map(s => {
        if (s.type === 'warmup') {
          warmupCount++;
          return { ...s, setNumber: warmupCount };
        }
        normalCount++;
        return { ...s, setNumber: normalCount };
      });
      return { ...block, sets: renumbered };
    }));
  }, []);

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
    }
  }, [blocks, getStickyNote, removeExercise, toggleDropSets, addWarmupSet]);

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

  const handleSupersetSave = useCallback((groups: Record<string, number | undefined>) => {
    setBlocks(prev => prev.map(b => ({ ...b, supersetGroup: groups[b.exerciseId] })));
    setShowSupersetLinker(false);
  }, []);

  const finishWorkout = useCallback(() => {
    // Guard: require at least one completed set
    const hasCompletedSet = blocks.some(b => b.sets.some(s => s.completed));
    if (!hasCompletedSet) {
      toast.error('Complete at least one set or Discard this workout.');
      return;
    }

    const exerciseLogs: ExerciseLog[] = normalizeBlocks(blocks)
      .filter(b => b.sets.some(s => s.completed))
      .map(b => {
        const mode = getExerciseInputMode(b.exerciseId, customExercises);
        const sets: WorkoutSet[] = [];
        b.sets.filter(s => s.completed).forEach(s => {
          const seconds = timeToSeconds(s.time);
          sets.push({
            setNumber: s.setNumber,
            type: s.type,
            reps: mode === 'cardio' ? 1 : (parseInt(s.reps) || 0),
            weight: mode === 'cardio' ? undefined : (s.weight ? toKg(parseFloat(s.weight), weightUnit) : undefined),
            rpe: s.rpe ? parseFloat(s.rpe) : undefined,
            time: seconds > 0 ? seconds : (mode === 'cardio' ? (parseInt(s.reps) || 0) : undefined),
          });
          // Append completed dropsets immediately after their parent set
          (s.drops ?? []).filter(d => d.completed).forEach(d => {
            const dSeconds = d.time ? timeToSeconds(d.time) : 0;
            sets.push({
              setNumber: s.setNumber,
              type: 'dropset',
              reps: mode === 'cardio' ? 1 : (parseInt(d.reps) || 0),
              weight: mode === 'cardio' ? undefined : (d.weight ? toKg(parseFloat(d.weight), weightUnit) : undefined),
              rpe: d.rpe ? parseFloat(d.rpe) : undefined,
              time: dSeconds > 0 ? dSeconds : undefined,
            });
          });
        });
        return {
          exerciseId: b.exerciseId,
          exerciseName: b.exerciseName,
          supersetGroup: b.supersetGroup,
          sets,
        };
      });

    const allSets = exerciseLogs.flatMap(l => l.sets);
    const totalReps = allSets.reduce((s, set) => s + set.reps, 0);
    const totalVolume = allSets.reduce((s, set) => s + set.reps * (set.weight ?? 0), 0);
    const rpeSets = allSets.filter(s => s.rpe !== undefined && s.type !== 'warmup');
    const averageRpe = rpeSets.length > 0 ? rpeSets.reduce((s, set) => s + (set.rpe ?? 0), 0) / rpeSets.length : undefined;

    let sessionDate: string;
    let duration: number;

    if (isEditMode && editSession) {
      sessionDate = editDate || editSession.date.substring(0, 10);
      duration = editDurationMin ? parseInt(editDurationMin) * 60 : editSession.duration;
    } else {
      sessionDate = format(new Date(), 'yyyy-MM-dd');
      duration = Math.floor((Date.now() - startTime.current) / 1000);
    }

    // Duration < 30s prompt
    if (!isEditMode && duration < 30) {
      if (!confirm('This workout was less than 30 seconds. Save anyway?')) return;
    }

    const finalSession: WorkoutSession = {
      id: isEditMode && editSession ? editSession.id : crypto.randomUUID(),
      date: sessionDate,
      exercises: exerciseLogs,
      duration,
      totalVolume,
      totalSets: allSets.length,
      totalReps,
      averageRpe,
      note: workoutNote.trim() || undefined,
    };

    // Check whether to prompt user about updating the source template
    const shouldCheckTemplate =
      !isEditMode &&
      template &&
      onUpdateTemplate &&
      originalTemplateSnapshot.current;

    if (shouldCheckTemplate) {
      const completedBlocks: FinishedBlockLite[] = blocks
        .filter(b => b.sets.some(s => s.completed))
        .map(b => {
          const completed = b.sets.filter(s => s.completed && s.type !== 'warmup');
          const lastReps = completed.length > 0 ? parseInt(completed[completed.length - 1].reps) || null : null;
          const setType = completed[0]?.type ?? b.sets[0]?.type ?? 'normal';
          return {
            exerciseId: b.exerciseId,
            completedSetCount: completed.length,
            lastReps,
            setType,
            supersetGroup: b.supersetGroup,
            restSeconds: b.restSeconds,
          };
        });
      const afterSnapshot = snapshotFromFinishedBlocks(completedBlocks);
      const diff = diffTemplateSnapshots(originalTemplateSnapshot.current!, afterSnapshot);
      if (diff.hasChanges) {
        const updated = buildUpdatedTemplate(template!, completedBlocks);
        setPendingFinishedSession(finalSession);
        setPendingTemplateUpdate({ template: updated, summary: diff.summary });
        return;
      }
    }

    onFinish(finalSession);
  }, [blocks, onFinish, isEditMode, editSession, editDate, editTime, editDurationMin, workoutNote, weightUnit, customExercises, template, onUpdateTemplate]);

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
    return (
      <div className="h-[100dvh] bg-background flex flex-col overflow-hidden min-w-0">
        <div className="p-4 pb-0 shrink-0">
          <Button variant="outline" onClick={() => setShowExercisePicker(false)} className="mb-2">← Back</Button>
        </div>
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
          <ExerciseSelector onSelect={addExercise} onSelectMultiple={addMultipleExercises} />
        </div>
      </div>
    );
  }

  const getSupersetColorClass = (group?: number) => {
    if (group === undefined) return '';
    return SUPERSET_COLORS[(group - 1) % SUPERSET_COLORS.length];
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        {isEditMode ? (
          <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
        ) : (
          <button onClick={onMinimize ?? onCancel} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-5 h-5" />
          </button>
        )}
        <div className="flex items-center gap-2">
          {/* 3-dot menu */}
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground p-1">
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
            </PopoverContent>
          </Popover>
          {!isEditMode && (
            <Button variant="outline" size="sm" onClick={() => setShowDiscardConfirm(true)} className="text-destructive border-destructive/30 hover:bg-destructive/10">
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Discard
            </Button>
          )}
          <Button variant="neon" size="sm" onClick={finishWorkout}>
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
                <button
                  key={loc}
                  onClick={() => { if (!longPressTimer.current) return; setLocation(loc); setShowLocationDropdown(false); }}
                  onPointerDown={() => {
                    longPressTimer.current = setTimeout(() => {
                      longPressTimer.current = null;
                      if (loc !== DEFAULT_LOCATION) setDeleteLocationConfirm(loc);
                    }, 500);
                  }}
                  onPointerUp={() => {
                    if (longPressTimer.current) {
                      clearTimeout(longPressTimer.current);
                      setLocation(loc);
                      setShowLocationDropdown(false);
                    }
                  }}
                  onPointerLeave={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors select-none ${loc === location ? 'text-primary font-medium' : 'text-foreground'}`}
                >
                  {loc}
                </button>
              ))}
              <div className="border-t border-border mt-1 pt-1 px-2 pb-1">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={newLocationInput}
                    onChange={e => setNewLocationInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustomLocation()}
                    placeholder="Add location..."
                    className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground px-1 py-1"
                  />
                  <button
                    onClick={addCustomLocation}
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
                className="bg-secondary/60 border border-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Time</label>
              <input
                type="time"
                value={editTime}
                onChange={e => setEditTime(e.target.value)}
                className="bg-secondary/60 border border-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
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
                className="w-20 bg-secondary/60 border border-border rounded-md px-2 py-1.5 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary"
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

      {/* Camera - hide in edit mode */}
      {!isEditMode && (
        <div className="px-4 pb-4">
          <CameraFeed />
        </div>
      )}

      {/* Note Editor Modal */}
      {editingNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-xl w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                {editingNote.type === 'sticky' ? '📌 Sticky Note' : '📝 Session Note'}
              </h3>
              <button onClick={() => setEditingNote(null)} className="text-muted-foreground hover:text-foreground">
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
              className="w-full bg-secondary/60 border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setEditingNote(null)}>Cancel</Button>
              <Button variant="neon" size="sm" onClick={saveNote}>Save</Button>
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
              return (
              <React.Fragment key={block.exerciseId}>
                {blockIdx > 0 && (
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
                    <div className={`rounded-lg ${getSupersetColorClass(block.supersetGroup)} ${block.supersetGroup !== undefined ? 'p-2' : ''}`}>
                      <ExerciseTable
                        block={block}
                        blockIdx={blockIdx}
                        weightUnit={weightUnit}
                        blocks={blocks}
                        stickyNote={getStickyNote(block.exerciseId)}
                        activeTimer={activeTimer}
                        restRecords={restRecords}
                        previousSets={getPreviousExerciseData(history, block.exerciseId)}
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
          onClick={() => setShowExercisePicker(true)}
          className="w-full py-3 rounded-lg border border-dashed border-muted-foreground/30 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Exercise
        </button>
      </div>

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
            className="w-full min-h-[100px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={500}
          />
          <p className="text-xs text-muted-foreground text-right">{workoutNote.length}/500</p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => setShowNoteDialog(false)}>Save</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard confirmation dialog */}
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
              onClick={onCancel}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
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
                saveLocations(updated);
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
      />

      {/* Update template prompt */}
      <AlertDialog
        open={!!pendingTemplateUpdate}
        onOpenChange={(open) => {
          if (!open && pendingFinishedSession) {
            // Treat dismiss (overlay click / escape) as "Keep template"
            const session = pendingFinishedSession;
            setPendingTemplateUpdate(null);
            setPendingFinishedSession(null);
            onFinish(session);
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
            <AlertDialogCancel
              onClick={() => {
                const session = pendingFinishedSession;
                setPendingTemplateUpdate(null);
                setPendingFinishedSession(null);
                if (session) onFinish(session);
              }}
            >
              Keep template
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const session = pendingFinishedSession;
                const tplUpdate = pendingTemplateUpdate;
                setPendingTemplateUpdate(null);
                setPendingFinishedSession(null);
                if (tplUpdate && onUpdateTemplate) {
                  try {
                    onUpdateTemplate(tplUpdate.template);
                    toast.success('Template updated');
                  } catch (e) {
                    console.error('[ActiveSession] update template failed:', e);
                    toast.error('Failed to update template');
                  }
                }
                if (session) onFinish(session);
              }}
            >
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

/* ---------- RPE Picker Button (Popover wrapper) ---------- */

const RpePickerButton: React.FC<{ id: string; value: string; onChange: (v: string) => void }> = ({ id, value, onChange }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary hover:bg-secondary/80 transition-colors"
        >
          {value || '—'}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-32 p-0">
        <RpeWheelPicker value={value} onChange={onChange} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
};

/* ---------- Time Input Button (mm:ss popover) ---------- */

const TimeInputButton: React.FC<{ id: string; value: string; onChange: (v: string) => void; running?: boolean; small?: boolean }> = ({ id, value, onChange, running, small }) => {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const seconds = timeToSeconds(value);
  const display = seconds > 0 ? formatMmSs(seconds) : '—';

  React.useEffect(() => {
    if (open) setDraft(seconds > 0 ? formatMmSs(seconds) : '');
  }, [open, seconds]);

  const commit = () => {
    const parsed = parseMmSs(draft);
    if (parsed === null) {
      onChange('');
    } else {
      onChange(String(parsed));
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className={`w-full text-center bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary hover:bg-secondary/80 transition-colors font-mono ${
            small ? 'text-[10px]' : 'text-sm'
          } ${running ? 'ring-1 ring-primary animate-pulse' : ''}`}
        >
          {display}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="w-48 p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground text-center mb-2">Time (m:ss)</div>
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
          }}
          placeholder="1:30"
          className="w-full text-center text-lg font-mono bg-secondary rounded-md py-2 text-foreground outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => { onChange(''); setOpen(false); }}
            className="flex-1 text-xs py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80"
          >
            Clear
          </button>
          <button
            onClick={commit}
            className="flex-1 text-xs py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90"
          >
            Done
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};



const FIELD_ORDER = ['weight', 'reps', 'rpe'] as const;

function buildInputId(blockIdx: number, setIdx: number, field: string, dropIdx?: number) {
  return dropIdx !== undefined
    ? `input-${blockIdx}-${setIdx}-d${dropIdx}-${field}`
    : `input-${blockIdx}-${setIdx}-${field}`;
}

/**
 * Collect all row keys for a block in order: set0, set0-drops, set1, set1-drops, etc.
 * Each row key is { setIdx, dropIdx? }
 */
function getBlockRows(block: ExerciseBlock): { setIdx: number; dropIdx?: number }[] {
  const rows: { setIdx: number; dropIdx?: number }[] = [];
  for (let si = 0; si < block.sets.length; si++) {
    rows.push({ setIdx: si });
    const drops = block.sets[si].drops;
    if (drops) {
      for (let di = 0; di < drops.length; di++) {
        rows.push({ setIdx: si, dropIdx: di });
      }
    }
  }
  return rows;
}

function handleInputNext(e: React.KeyboardEvent<HTMLInputElement>, blocks: ExerciseBlock[], blockIdx: number, setIdx: number, field: string, dropIdx?: number) {
  if (e.key !== 'Enter') return;
  e.preventDefault();

  const block = blocks[blockIdx];
  const rows = getBlockRows(block);
  const currentRowIdx = rows.findIndex(r => r.setIdx === setIdx && r.dropIdx === dropIdx);
  const currentFieldIdx = FIELD_ORDER.indexOf(field as typeof FIELD_ORDER[number]);

  // Try next column in same row (weight→reps→RPE)
  if (currentFieldIdx < FIELD_ORDER.length - 1) {
    const nextField = FIELD_ORDER[currentFieldIdx + 1];
    const nextId = buildInputId(blockIdx, setIdx, nextField, dropIdx);
    const el = document.getElementById(nextId) as HTMLInputElement | null;
    if (el) { el.focus(); return; }
  }

  // End of row → next row's weight
  if (currentRowIdx < rows.length - 1) {
    const nextRow = rows[currentRowIdx + 1];
    const nextId = buildInputId(blockIdx, nextRow.setIdx, FIELD_ORDER[0], nextRow.dropIdx);
    const el = document.getElementById(nextId) as HTMLInputElement | null;
    if (el) { el.focus(); return; }
  }

  // End of block → next block's first row weight
  if (blockIdx < blocks.length - 1) {
    const nextBlock = blocks[blockIdx + 1];
    const nextRows = getBlockRows(nextBlock);
    if (nextRows.length > 0) {
      const firstRow = nextRows[0];
      const nextId = buildInputId(blockIdx + 1, firstRow.setIdx, FIELD_ORDER[0], firstRow.dropIdx);
      const el = document.getElementById(nextId) as HTMLInputElement | null;
      if (el) { el.focus(); return; }
    }
  }

  // Nothing left — blur
  (e.target as HTMLInputElement).blur();
}

/* ---------- Exercise Table Sub-component ---------- */

interface ExerciseTableProps {
  block: ExerciseBlock;
  blockIdx: number;
  weightUnit: WeightUnit;
  blocks: ExerciseBlock[];
  stickyNote: string;
  activeTimer: PersistedTimer | null;
  restRecords: Record<string, number>;
  previousSets: { weight?: number; reps: number; rpe?: number; time?: number }[];
  inputMode: ExerciseInputMode;
  onUpdateSet: (blockIdx: number, setIdx: number, field: keyof SetRow, value: string | boolean | number) => void;
  onToggleComplete: (blockIdx: number, setIdx: number) => void;
  onAddSet: (blockIdx: number) => void;
  onAddDrop: (blockIdx: number, setIdx: number) => void;
  onUpdateDrop: (blockIdx: number, setIdx: number, dropIdx: number, field: keyof DropRow, value: string | boolean) => void;
  onRemoveSet: (blockIdx: number, setIdx: number) => void;
  onRemoveDrop: (blockIdx: number, setIdx: number, dropIdx: number) => void;
  onMenuAction: (action: string, blockIdx: number) => void;
  onStartTimer: (id: TimerId, duration: number) => void;
  onSkipTimer: () => void;
  onExtendTimer: (delta?: number) => void;
  onTitleTap?: () => void;
  isEditMode?: boolean;
  runningSet?: RunningSetState | null;
  onStartNextSet?: (blockIdx: number) => void;
  onStopSet?: () => void;
}

const EXERCISE_MENU_ITEMS = [
  { icon: FileText, label: 'Add Note' },
  { icon: StickyNote, label: 'Add Sticky Note' },
  { icon: Flame, label: 'Add Warm-up Sets' },
  { icon: Timer, label: 'Update Rest Timer' },
  { icon: RefreshCw, label: 'Replace Exercise' },
  { icon: Layers, label: 'Create Superset' },
  { icon: ChevronDown, label: 'Drop Sets', toggle: true },
  { icon: Trash2, label: 'Remove Exercise', destructive: true },
] as const;


const ExerciseTable: React.FC<ExerciseTableProps> = ({ block, blockIdx, weightUnit, blocks, stickyNote, activeTimer, restRecords, previousSets, inputMode, onUpdateSet, onToggleComplete, onAddSet, onAddDrop, onUpdateDrop, onRemoveSet, onRemoveDrop, onMenuAction, onStartTimer, onSkipTimer, onExtendTimer, onTitleTap, isEditMode, runningSet, onStartNextSet, onStopSet }) => {
  const isRunningHere = runningSet?.blockIdx === blockIdx;
  return (
    <div>
      {/* Exercise Header */}
      <div className="flex items-center justify-between mb-1 gap-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTitleTap?.(); }}
          className="text-sm font-semibold text-primary text-left hover:underline focus:outline-none focus:underline truncate"
        >
          {block.exerciseName}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {!isEditMode && onStartNextSet && (
            <button
              onClick={() => (isRunningHere ? onStopSet?.() : onStartNextSet(blockIdx))}
              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors ${
                isRunningHere
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : 'bg-primary text-primary-foreground hover:bg-primary/90'
              }`}
            >
              {isRunningHere ? 'Stop set' : 'Start next set'}
            </button>
          )}
          <Popover>
          <PopoverTrigger asChild>
            <button className="text-muted-foreground hover:text-foreground p-1">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-52 p-1">
            {EXERCISE_MENU_ITEMS.map(item => (
              <button
                key={item.label}
                onClick={() => onMenuAction(item.label, blockIdx)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
                  'destructive' in item && item.destructive
                    ? 'text-destructive hover:bg-destructive/10'
                    : 'text-foreground hover:bg-secondary'
                }`}
              >
                <item.icon className="w-4 h-4" />
                {'toggle' in item && item.toggle ? (
                  <span className="flex-1 flex items-center justify-between">
                    <span>{item.label}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${block.dropSetsEnabled ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                      {block.dropSetsEnabled ? 'ON' : 'OFF'}
                    </span>
                  </span>
                ) : (
                  item.label
                )}
              </button>
            ))}
          </PopoverContent>
        </Popover>
        </div>
      </div>

      {/* Sticky Note display */}
      {stickyNote && (
        <div
          className="mb-2 px-2 py-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-200 flex items-start gap-1.5 cursor-pointer hover:bg-yellow-500/20 transition-colors"
          onClick={() => onMenuAction('Add Sticky Note', blockIdx)}
        >
          <StickyNote className="w-3 h-3 mt-0.5 shrink-0 text-yellow-400" />
          {stickyNote}
        </div>
      )}

      {/* Session Note display */}
      {block.note && (
        <div
          className="mb-2 px-2 py-1.5 rounded-md bg-primary/5 border border-primary/20 text-xs text-muted-foreground flex items-start gap-1.5 cursor-pointer hover:bg-primary/10 transition-colors"
          onClick={() => onMenuAction('Add Note', blockIdx)}
        >
          <FileText className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
          {block.note}
        </div>
      )}

      {/* Table Header */}
      {inputMode === 'cardio' ? (
        <div className="grid grid-cols-[32px_1fr_1fr_30px_36px] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
          <span>Set</span>
          <span className="text-center">Time</span>
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-center w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors underline decoration-dotted underline-offset-2">RPE</button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-64 p-3 text-xs leading-relaxed text-foreground">
              <p className="font-semibold mb-1">Rate of Perceived Exertion (RPE)</p>
              <p className="text-muted-foreground">A subjective 1–10 scale measuring how hard an exercise feels.</p>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-center w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
                <Timer className="w-3 h-3 mx-auto" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-56 p-3 text-xs leading-relaxed text-foreground">
              <p className="font-semibold mb-1">Time elapsed</p>
              <p className="text-muted-foreground">Time it took to complete the set, captured automatically when you start and finish a set.</p>
            </PopoverContent>
          </Popover>
          <span className="text-center">
            <Check className="w-3 h-3 mx-auto" />
          </span>
        </div>
      ) : inputMode === 'band' ? (
        <div className="grid grid-cols-[32px_1fr_1fr_1fr_42px_30px_36px] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
          <span>Set</span>
          <span className="text-center">Previous</span>
          <span className="text-center">Band</span>
          <span className="text-center">Reps</span>
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-center w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors underline decoration-dotted underline-offset-2">RPE</button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-64 p-3 text-xs leading-relaxed text-foreground">
              <p className="font-semibold mb-1">Rate of Perceived Exertion (RPE)</p>
              <p className="text-muted-foreground">A subjective 1–10 scale measuring how hard an exercise feels.</p>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <button className="text-center w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
                <Timer className="w-3 h-3 mx-auto" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-56 p-3 text-xs leading-relaxed text-foreground">
              <p className="font-semibold mb-1">Time elapsed</p>
              <p className="text-muted-foreground">Time it took to complete the set, captured automatically when you start and finish a set.</p>
            </PopoverContent>
          </Popover>
          <span className="text-center">
            <Check className="w-3 h-3 mx-auto" />
          </span>
        </div>
      ) : (
      <div className="grid grid-cols-[32px_1fr_1fr_1fr_42px_30px_36px] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
        <span>Set</span>
        <span className="text-center">Previous</span>
        <span className="text-center">{weightUnit}</span>
        <span className="text-center">Reps</span>
        <Popover>
          <PopoverTrigger asChild>
            <button className="text-center w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors underline decoration-dotted underline-offset-2">RPE</button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-64 p-3 text-xs leading-relaxed text-foreground">
            <p className="font-semibold mb-1">Rate of Perceived Exertion (RPE)</p>
            <p className="text-muted-foreground">A subjective 1–10 scale measuring how hard an exercise feels. It helps prevent overtraining and optimizes training loads without specialized equipment.</p>
            <ul className="mt-2 space-y-0.5 text-muted-foreground">
              <li><span className="font-medium text-foreground">1–3:</span> Light</li>
              <li><span className="font-medium text-foreground">4–6:</span> Moderate</li>
              <li><span className="font-medium text-foreground">7–9:</span> Hard</li>
              <li><span className="font-medium text-foreground">10:</span> Max effort / failure</li>
            </ul>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <button className="text-center w-full text-xs font-medium text-muted-foreground hover:text-primary transition-colors">
              <Timer className="w-3 h-3 mx-auto" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-56 p-3 text-xs leading-relaxed text-foreground">
            <p className="font-semibold mb-1">Time elapsed</p>
            <p className="text-muted-foreground">Time it took to complete the set, captured automatically when you start and finish a set.</p>
          </PopoverContent>
        </Popover>
        <span className="text-center">
          <Check className="w-3 h-3 mx-auto" />
        </span>
      </div>
      )}

      {/* Set Rows */}
      {block.sets.map((set, setIdx) => {
        const superscripts = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
        return (
          <React.Fragment key={setIdx}>
            <SwipeToDelete onDelete={() => onRemoveSet(blockIdx, setIdx)}>
              {inputMode === 'cardio' ? (
                <div className={`grid grid-cols-[32px_1fr_1fr_30px_36px] gap-1 items-center py-1.5 px-1 rounded-md ${set.completed ? 'bg-primary/10' : ''}`}>
                  <span className={`text-xs font-bold text-center ${set.type === 'warmup' ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                    {set.type === 'warmup' ? `W${set.setNumber}` : set.setNumber}
                  </span>
                  <TimeInputButton
                    id={buildInputId(blockIdx, setIdx, 'time')}
                    value={set.time}
                    onChange={v => onUpdateSet(blockIdx, setIdx, 'time', v)}
                    running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx}
                  />
                  <RpePickerButton
                    id={buildInputId(blockIdx, setIdx, 'rpe')}
                    value={set.rpe}
                    onChange={v => onUpdateSet(blockIdx, setIdx, 'rpe', v)}
                  />
                  <span />
                  <button
                    onClick={() => onToggleComplete(blockIdx, setIdx)}
                    className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                      set.completed ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div
                  className={`grid grid-cols-[32px_1fr_1fr_1fr_42px_30px_36px] gap-1 items-center py-1.5 px-1 rounded-md ${
                    set.completed ? 'bg-primary/10' : ''
                  }`}
                >
                  <span className={`text-xs font-bold text-center ${set.type === 'warmup' ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                    {set.type === 'warmup' ? `W${set.setNumber}` : set.setNumber}
                  </span>
                  {previousSets[setIdx] ? (
                    <button
                      type="button"
                      onClick={() => {
                        const prev = previousSets[setIdx];
                        if (prev.weight !== undefined) onUpdateSet(blockIdx, setIdx, 'weight', String(Math.round(fromKg(prev.weight, weightUnit))));
                        if (prev.reps !== undefined) onUpdateSet(blockIdx, setIdx, 'reps', String(prev.reps));
                        if (prev.rpe !== undefined) onUpdateSet(blockIdx, setIdx, 'rpe', String(prev.rpe));
                        if (prev.time !== undefined) onUpdateSet(blockIdx, setIdx, 'time', String(prev.time));
                      }}
                      className="text-xs text-muted-foreground text-center truncate w-full hover:text-primary hover:bg-primary/10 rounded-md py-0.5 transition-colors cursor-pointer"
                      title="Tap to copy to current set"
                    >
                      {`${previousSets[setIdx].weight != null ? Math.round(fromKg(previousSets[setIdx].weight!, weightUnit)) : '—'} × ${previousSets[setIdx].reps}`}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground text-center">—</span>
                  )}
                  {inputMode === 'band' ? (
                    <select
                      id={buildInputId(blockIdx, setIdx, 'weight')}
                      value={set.weight}
                      onChange={e => onUpdateSet(blockIdx, setIdx, 'weight', e.target.value)}
                      className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                    >
                      <option value="">—</option>
                      {BAND_LEVELS.map(b => (
                        <option key={b.level} value={b.level.toString()}>{getBandLevelLabel(b.level, weightUnit)}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={buildInputId(blockIdx, setIdx, 'weight')}
                      type="number"
                      inputMode="decimal"
                      value={set.weight}
                      onChange={e => onUpdateSet(blockIdx, setIdx, 'weight', e.target.value)}
                      onKeyDown={e => handleInputNext(e, blocks, blockIdx, setIdx, 'weight')}
                      onFocus={e => e.target.value && e.target.select()}
                      placeholder="—"
                      className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                    />
                  )}
                  <input
                    id={buildInputId(blockIdx, setIdx, 'reps')}
                    type="number"
                    inputMode="numeric"
                    value={set.reps}
                    onChange={e => onUpdateSet(blockIdx, setIdx, 'reps', e.target.value)}
                    onKeyDown={e => handleInputNext(e, blocks, blockIdx, setIdx, 'reps')}
                    onFocus={e => e.target.value && e.target.select()}
                    placeholder="—"
                    className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                  />
                  <RpePickerButton
                    id={buildInputId(blockIdx, setIdx, 'rpe')}
                    value={set.rpe}
                    onChange={v => onUpdateSet(blockIdx, setIdx, 'rpe', v)}
                  />
                  <TimeInputButton
                    id={buildInputId(blockIdx, setIdx, 'time')}
                    value={set.time}
                    onChange={v => onUpdateSet(blockIdx, setIdx, 'time', v)}
                    running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx}
                    small
                  />
                  <button
                    onClick={() => onToggleComplete(blockIdx, setIdx)}
                    className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                      set.completed
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              )}
            </SwipeToDelete>

            {/* Drop rows */}
            {set.drops?.map((drop, dropIdx) => (
              <SwipeToDelete key={`drop-${setIdx}-${dropIdx}`} onDelete={() => onRemoveDrop(blockIdx, setIdx, dropIdx)}>
                {inputMode === 'cardio' ? (
                  <div
                    className={`grid grid-cols-[32px_1fr_1fr_30px_36px] gap-1 items-center py-1.5 px-1 rounded-md ml-4 border-l-2 border-set-dropset/40 ${
                      drop.completed ? 'bg-primary/10' : ''
                    }`}
                  >
                    <span className="text-xs font-bold text-set-dropset text-center">
                      {set.setNumber}D{superscripts[dropIdx] ?? `${dropIdx + 1}`}
                    </span>
                    <TimeInputButton
                      id={buildInputId(blockIdx, setIdx, 'time', dropIdx)}
                      value={drop.time ?? ''}
                      onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'time', v)}
                      running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx && runningSet?.dropIdx === dropIdx}
                    />
                    <RpePickerButton
                      id={buildInputId(blockIdx, setIdx, 'rpe', dropIdx)}
                      value={drop.rpe}
                      onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'rpe', v)}
                    />
                    <span />
                    <button
                      onClick={() => onUpdateDrop(blockIdx, setIdx, dropIdx, 'completed', !drop.completed)}
                      className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                        drop.completed ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                <div
                  className={`grid grid-cols-[32px_1fr_1fr_1fr_42px_30px_36px] gap-1 items-center py-1.5 px-1 rounded-md ml-4 border-l-2 border-set-dropset/40 ${
                    drop.completed ? 'bg-primary/10' : ''
                  }`}
                >
                  <span className="text-xs font-bold text-set-dropset text-center">
                    {set.setNumber}D{superscripts[dropIdx] ?? `${dropIdx + 1}`}
                  </span>
                  <span className="text-xs text-muted-foreground text-center">—</span>
                  {inputMode === 'band' ? (
                    <select
                      id={buildInputId(blockIdx, setIdx, 'weight', dropIdx)}
                      value={drop.weight}
                      onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'weight', e.target.value)}
                      className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                    >
                      <option value="">—</option>
                      {BAND_LEVELS.map(b => (
                        <option key={b.level} value={b.level.toString()}>{getBandLevelLabel(b.level, weightUnit)}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={buildInputId(blockIdx, setIdx, 'weight', dropIdx)}
                      type="number"
                      inputMode="decimal"
                      value={drop.weight}
                      onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'weight', e.target.value)}
                      onKeyDown={e => handleInputNext(e, blocks, blockIdx, setIdx, 'weight', dropIdx)}
                      placeholder="—"
                      className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                    />
                  )}
                  <input
                    id={buildInputId(blockIdx, setIdx, 'reps', dropIdx)}
                    type="number"
                    inputMode="numeric"
                    value={drop.reps}
                    onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'reps', e.target.value)}
                    onKeyDown={e => handleInputNext(e, blocks, blockIdx, setIdx, 'reps', dropIdx)}
                    placeholder="—"
                    className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                  />
                  <RpePickerButton
                    id={buildInputId(blockIdx, setIdx, 'rpe', dropIdx)}
                    value={drop.rpe}
                    onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'rpe', v)}
                  />
                  <TimeInputButton
                    id={buildInputId(blockIdx, setIdx, 'time', dropIdx)}
                    value={drop.time ?? ''}
                    onChange={v => onUpdateDrop(blockIdx, setIdx, dropIdx, 'time', v)}
                    running={runningSet?.blockIdx === blockIdx && runningSet?.setIdx === setIdx && runningSet?.dropIdx === dropIdx}
                    small
                  />
                  <button
                    onClick={() => onUpdateDrop(blockIdx, setIdx, dropIdx, 'completed', !drop.completed)}
                    className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
                      drop.completed
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
                )}
              </SwipeToDelete>
            ))}

            {/* Add Drop button for any set - only when dropsets enabled */}
            {block.dropSetsEnabled && (
              <button
                onClick={() => onAddDrop(blockIdx, setIdx)}
                className="ml-4 py-1 px-3 text-xs text-set-dropset/70 hover:text-set-dropset transition-colors"
              >
                + Add Dropset
              </button>
            )}

            {/* Between-set rest timer */}
            {setIdx < block.sets.length - 1 && (() => {
              const betweenSetId: TimerId = { type: 'set', blockIdx, setIdx };
              const betweenSetKey = timerIdKey(betweenSetId);
              const isBetweenSetActive = activeTimer !== null && timerIdKey(activeTimer.id) === betweenSetKey;
              return (
                <ExerciseRestTimer
                  timerId={betweenSetId}
                  defaultDuration={block.restSeconds}
                  variant="between"
                  isActive={isBetweenSetActive}
                  remaining={isBetweenSetActive ? Math.ceil((activeTimer!.startedAtEpoch + activeTimer!.duration * 1000 - Date.now()) / 1000) : 0}
                  totalDuration={isBetweenSetActive ? activeTimer!.originalDuration : 0}
                  recordedRest={restRecords[betweenSetKey] ?? null}
                  onStart={onStartTimer}
                  onSkip={onSkipTimer}
                  onExtend={onExtendTimer}
                />
              );
            })()}
          </React.Fragment>
        );
      })}

      {/* Add Set */}
      <button
        onClick={() => onAddSet(blockIdx)}
        className="w-full py-2 mt-1 rounded-md bg-secondary/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
      >
        + Add Set
      </button>
    </div>
  );
};