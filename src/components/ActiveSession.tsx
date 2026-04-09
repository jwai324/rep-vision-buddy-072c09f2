import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { ExerciseId, ExerciseLog, SetType, WorkoutSession, TemplateExercise } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { CameraFeed } from '@/components/CameraFeed';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { SupersetLinker } from '@/components/SupersetLinker';
import { Button } from '@/components/ui/button';
import { Check, Plus, MoreHorizontal, StickyNote, FileText, Flame, Timer, RefreshCw, Layers, ChevronDown, Trash2, X } from 'lucide-react';
import { SwipeToDelete } from '@/components/SwipeToDelete';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useStickyNotes } from '@/hooks/useStickyNotes';
import { ExerciseRestTimer, type TimerId } from '@/components/ExerciseRestTimer';

interface ActiveSessionProps {
  exercises: ExerciseId[];
  templateExercises?: TemplateExercise[];
  history?: WorkoutSession[];
  onFinish: (session: WorkoutSession) => void;
  onCancel: () => void;
}

/** Look up the most recent session data for a given exercise */
function getPreviousExerciseData(history: WorkoutSession[], exerciseId: ExerciseId): { weight?: number; reps: number }[] {
  for (const session of history) {
    const log = session.exercises.find(e => e.exerciseId === exerciseId);
    if (log && log.sets.length > 0) {
      return log.sets.map(s => ({ weight: s.weight, reps: s.reps }));
    }
  }
  return [];
}

interface DropRow {
  weight: string;
  reps: string;
  rpe: string;
  completed: boolean;
}

interface SetRow {
  setNumber: number;
  weight: string;
  reps: string;
  completed: boolean;
  type: SetType;
  rpe: string;
  drops?: DropRow[];
}

interface ExerciseBlock {
  exerciseId: ExerciseId;
  exerciseName: string;
  sets: SetRow[];
  note?: string; // session-only note
  supersetGroup?: number;
  restSeconds: number;
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

const timerIdKey = (id: TimerId) => `${id.type}-${id.blockIdx}-${id.setIdx ?? ''}`;

export const ActiveSession: React.FC<ActiveSessionProps> = ({ exercises: initialExercises, templateExercises, history = [], onFinish, onCancel }) => {
  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() =>
    initialExercises.map((id, idx) => {
      const tpl = templateExercises?.[idx];
      const numSets = tpl?.sets ?? 3;
      const restSec = tpl?.restSeconds ?? 90;
      return {
        exerciseId: id,
        exerciseName: EXERCISES[id]?.name ?? id,
        restSeconds: restSec,
        sets: Array.from({ length: numSets }, (_, i) => ({
          setNumber: i + 1,
          weight: '',
          reps: tpl?.targetReps === 'failure' ? '' : (tpl?.targetReps?.toString() ?? ''),
          completed: false,
          type: tpl?.setType ?? 'normal',
          rpe: '',
        })),
      };
    })
  );
  const [workoutName, setWorkoutName] = useState('Workout');
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [showSupersetLinker, setShowSupersetLinker] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTime = useRef(Date.now());
  const { getStickyNote, setStickyNote } = useStickyNotes();
  // Centralized single-timer state
  const [activeTimer, setActiveTimer] = useState<{ id: TimerId; remaining: number; duration: number; startedAt: number } | null>(null);
  const [restRecords, setRestRecords] = useState<Record<string, number>>({});
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback((id: TimerId, duration: number) => {
    // Cancel any existing timer
    if (timerInterval.current) clearInterval(timerInterval.current);
    // Record the old timer if it was running
    setActiveTimer(prev => {
      if (prev) {
        const elapsed = prev.duration - prev.remaining;
        setRestRecords(r => ({ ...r, [timerIdKey(prev.id)]: elapsed }));
      }
      return null;
    });
    const timer = { id, remaining: duration, duration, startedAt: Date.now() };
    setActiveTimer(timer);
  }, []);

  const skipTimer = useCallback(() => {
    if (timerInterval.current) clearInterval(timerInterval.current);
    setActiveTimer(prev => {
      if (prev) {
        const elapsed = prev.duration - prev.remaining;
        setRestRecords(r => ({ ...r, [timerIdKey(prev.id)]: elapsed }));
      }
      return null;
    });
  }, []);

  const extendTimer = useCallback(() => {
    setActiveTimer(prev => prev ? { ...prev, remaining: prev.remaining + 30, duration: prev.duration + 30 } : null);
  }, []);

  // Timer tick effect
  useEffect(() => {
    if (timerInterval.current) clearInterval(timerInterval.current);
    if (activeTimer && activeTimer.remaining > 0) {
      timerInterval.current = setInterval(() => {
        setActiveTimer(prev => {
          if (!prev) return null;
          if (prev.remaining <= 1) {
            // Timer finished - record it
            setRestRecords(r => ({ ...r, [timerIdKey(prev.id)]: prev.duration }));
            return null;
          }
          return { ...prev, remaining: prev.remaining - 1 };
        });
      }, 1000);
    }
    return () => { if (timerInterval.current) clearInterval(timerInterval.current); };
  }, [activeTimer?.id.type, activeTimer?.id.blockIdx, activeTimer?.id.setIdx, activeTimer !== null]);

  // Note editing state
  const [editingNote, setEditingNote] = useState<{ blockIdx: number; type: 'note' | 'sticky' } | null>(null);
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const updateSet = useCallback((blockIdx: number, setIdx: number, field: keyof SetRow, value: string | boolean | number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      return {
        ...block,
        sets: block.sets.map((set, si) => {
          if (si !== setIdx) return set;
          return { ...set, [field]: value };
        }),
      };
    }));
  }, []);

  const toggleSetComplete = useCallback((blockIdx: number, setIdx: number) => {
    setBlocks(prev => {
      const block = prev[blockIdx];
      const wasCompleted = block.sets[setIdx].completed;
      const updated = prev.map((b, bi) => {
        if (bi !== blockIdx) return b;
        return {
          ...b,
          sets: b.sets.map((set, si) => {
            if (si !== setIdx) return set;
            return { ...set, completed: !set.completed };
          }),
        };
      });
      // Auto-start rest timer when completing a set (not unchecking)
      if (!wasCompleted) {
        startTimer({ type: 'set', blockIdx, setIdx }, block.restSeconds);
      }
      return updated;
    });
  }, [startTimer]);

  const addSet = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      const lastSet = block.sets[block.sets.length - 1];
      return {
        ...block,
        sets: [...block.sets, {
          setNumber: block.sets.length + 1,
          weight: lastSet?.weight ?? '',
          reps: lastSet?.reps ?? '',
          completed: false,
          type: lastSet?.type ?? 'normal',
          rpe: '',
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
          return { ...set, type: 'dropset' as SetType, drops: [...drops, { weight: '', reps: '', rpe: '', completed: false }] };
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
      const newSets = block.sets.filter((_, si) => si !== setIdx)
        .map((s, i) => ({ ...s, setNumber: i + 1 }));
      return { ...block, sets: newSets };
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
          return { ...set, drops: newDrops.length > 0 ? newDrops : undefined, type: newDrops.length > 0 ? 'dropset' : 'normal' as SetType };
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
          exerciseName: EXERCISES[id]?.name ?? id,
          restSeconds: 90,
          sets: Array.from({ length: 3 }, (_, i) => ({
            setNumber: i + 1,
            weight: '',
            reps: '',
            completed: false,
            type: 'normal' as SetType,
            rpe: '',
          })),
        }));
      return [...prev, ...newBlocks];
    });
    setShowExercisePicker(false);
  }, []);

  const removeExercise = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.filter((_, i) => i !== blockIdx));
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
      case 'Create Drop Set': {
        const lastSetIdx = blocks[blockIdx].sets.length - 1;
        if (lastSetIdx >= 0) addDrop(blockIdx, lastSetIdx);
        break;
      }
      case 'Remove Exercise':
        removeExercise(blockIdx);
        break;
    }
  }, [blocks, getStickyNote, removeExercise, addDrop]);

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
    const duration = Math.floor((Date.now() - startTime.current) / 1000);
    const exerciseLogs: ExerciseLog[] = blocks
      .filter(b => b.sets.some(s => s.completed))
      .map(b => ({
        exerciseId: b.exerciseId,
        exerciseName: b.exerciseName,
        sets: b.sets
          .filter(s => s.completed)
          .map(s => ({
            setNumber: s.setNumber,
            type: s.type,
            reps: parseInt(s.reps) || 0,
            weight: s.weight ? parseFloat(s.weight) : undefined,
            rpe: s.rpe ? parseFloat(s.rpe) : undefined,
          })),
      }));

    const allSets = exerciseLogs.flatMap(l => l.sets);
    const totalReps = allSets.reduce((s, set) => s + set.reps, 0);
    const totalVolume = allSets.reduce((s, set) => s + set.reps * (set.weight ?? 0), 0);
    const rpeSets = allSets.filter(s => s.rpe !== undefined);
    const averageRpe = rpeSets.length > 0 ? rpeSets.reduce((s, set) => s + (set.rpe ?? 0), 0) / rpeSets.length : undefined;

    onFinish({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      exercises: exerciseLogs,
      duration,
      totalVolume,
      totalSets: allSets.length,
      totalReps,
      averageRpe,
    });
  }, [blocks, onFinish]);

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
      <div className="min-h-screen bg-background flex flex-col">
        <div className="p-4 pb-0">
          <Button variant="outline" onClick={() => setShowExercisePicker(false)} className="mb-2">← Back</Button>
        </div>
        <ExerciseSelector onSelect={addExercise} onSelectMultiple={addMultipleExercises} />
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
        <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
        <Button variant="neon" size="sm" onClick={finishWorkout}>Finish</Button>
      </div>

      {/* Title + Timer */}
      <div className="px-4 pb-3">
        <input
          type="text"
          value={workoutName}
          onChange={e => setWorkoutName(e.target.value)}
          className="text-xl font-bold text-foreground bg-transparent outline-none border-b border-transparent focus:border-primary transition-colors w-full"
        />
        <p className="text-sm text-muted-foreground">{formatTime(elapsedSeconds)}</p>
      </div>

      {/* Camera */}
      <div className="px-4 pb-4">
        <CameraFeed />
      </div>

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
      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-2">
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
                remaining={isBetweenActive ? activeTimer!.remaining : 0}
                totalDuration={isBetweenActive ? activeTimer!.duration : 0}
                recordedRest={restRecords[betweenKey] ?? null}
                onStart={startTimer}
                onSkip={skipTimer}
                onExtend={extendTimer}
              />
            )}
            <div className={`rounded-lg ${getSupersetColorClass(block.supersetGroup)} ${block.supersetGroup !== undefined ? 'p-2' : ''}`}>
              <ExerciseTable
                block={block}
                blockIdx={blockIdx}
                stickyNote={getStickyNote(block.exerciseId)}
                activeTimer={activeTimer}
                restRecords={restRecords}
                previousSets={getPreviousExerciseData(history, block.exerciseId)}
                onUpdateSet={updateSet}
                onToggleComplete={toggleSetComplete}
                onAddSet={addSet}
                onAddDrop={addDrop}
                onUpdateDrop={updateDrop}
                onMenuAction={handleMenuAction}
                onStartTimer={startTimer}
                onSkipTimer={skipTimer}
                onExtendTimer={extendTimer}
              />
            </div>
          </React.Fragment>
          );
        })}

        {/* Add Exercise */}
        <button
          onClick={() => setShowExercisePicker(true)}
          className="w-full py-3 rounded-lg border border-dashed border-muted-foreground/30 text-sm text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Exercise
        </button>
      </div>
    </div>
  );
};

/* ---------- Exercise Table Sub-component ---------- */

interface ExerciseTableProps {
  block: ExerciseBlock;
  blockIdx: number;
  stickyNote: string;
  activeTimer: { id: TimerId; remaining: number; duration: number; startedAt: number } | null;
  restRecords: Record<string, number>;
  previousSets: { weight?: number; reps: number }[];
  onUpdateSet: (blockIdx: number, setIdx: number, field: keyof SetRow, value: string | boolean | number) => void;
  onToggleComplete: (blockIdx: number, setIdx: number) => void;
  onAddSet: (blockIdx: number) => void;
  onAddDrop: (blockIdx: number, setIdx: number) => void;
  onUpdateDrop: (blockIdx: number, setIdx: number, dropIdx: number, field: keyof DropRow, value: string | boolean) => void;
  onMenuAction: (action: string, blockIdx: number) => void;
  onStartTimer: (id: TimerId, duration: number) => void;
  onSkipTimer: () => void;
  onExtendTimer: () => void;
}

const EXERCISE_MENU_ITEMS = [
  { icon: FileText, label: 'Add Note' },
  { icon: StickyNote, label: 'Add Sticky Note' },
  { icon: Flame, label: 'Add Warm-up Sets' },
  { icon: Timer, label: 'Update Rest Timer' },
  { icon: RefreshCw, label: 'Replace Exercise' },
  { icon: Layers, label: 'Create Superset' },
  { icon: ChevronDown, label: 'Create Drop Set' },
  { icon: Trash2, label: 'Remove Exercise', destructive: true },
] as const;


const ExerciseTable: React.FC<ExerciseTableProps> = ({ block, blockIdx, stickyNote, activeTimer, restRecords, previousSets, onUpdateSet, onToggleComplete, onAddSet, onAddDrop, onUpdateDrop, onMenuAction, onStartTimer, onSkipTimer, onExtendTimer }) => {
  return (
    <div>
      {/* Exercise Header */}
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-primary">{block.exerciseName}</h3>
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
                {item.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      {/* Sticky Note display */}
      {stickyNote && (
        <div className="mb-2 px-2 py-1.5 rounded-md bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-200 flex items-start gap-1.5">
          <StickyNote className="w-3 h-3 mt-0.5 shrink-0 text-yellow-400" />
          {stickyNote}
        </div>
      )}

      {/* Session Note display */}
      {block.note && (
        <div className="mb-2 px-2 py-1.5 rounded-md bg-primary/5 border border-primary/20 text-xs text-muted-foreground flex items-start gap-1.5">
          <FileText className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
          {block.note}
        </div>
      )}

      {/* Table Header */}
      <div className="grid grid-cols-[32px_1fr_1fr_1fr_42px_30px_36px] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
        <span>Set</span>
        <span className="text-center">Previous</span>
        <span className="text-center">lbs</span>
        <span className="text-center">Reps</span>
        <span className="text-center">RPE</span>
        <span className="text-center">
          <Timer className="w-3 h-3 mx-auto" />
        </span>
        <span className="text-center">
          <Check className="w-3 h-3 mx-auto" />
        </span>
      </div>

      {/* Set Rows */}
      {block.sets.map((set, setIdx) => {
        const superscripts = ['¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
        return (
          <React.Fragment key={setIdx}>
            <div
              className={`grid grid-cols-[32px_1fr_1fr_1fr_42px_30px_36px] gap-1 items-center py-1.5 px-1 rounded-md ${
                set.completed ? 'bg-primary/10' : ''
              }`}
            >
              <span className="text-xs font-bold text-muted-foreground text-center">{set.setNumber}</span>
              {previousSets[setIdx] ? (
                <button
                  type="button"
                  onClick={() => {
                    const prev = previousSets[setIdx];
                    if (prev.weight !== undefined) onUpdateSet(blockIdx, setIdx, 'weight', String(prev.weight));
                    onUpdateSet(blockIdx, setIdx, 'reps', String(prev.reps));
                  }}
                  className="text-xs text-muted-foreground text-center truncate w-full hover:text-primary hover:bg-primary/10 rounded-md py-0.5 transition-colors cursor-pointer"
                  title="Tap to copy to current set"
                >
                  {`${previousSets[setIdx].weight ?? '—'} × ${previousSets[setIdx].reps}`}
                </button>
              ) : (
                <span className="text-xs text-muted-foreground text-center">—</span>
              )}
              <input
                type="number"
                inputMode="decimal"
                value={set.weight}
                onChange={e => onUpdateSet(blockIdx, setIdx, 'weight', e.target.value)}
                placeholder="—"
                className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
              />
              <input
                type="number"
                inputMode="numeric"
                value={set.reps}
                onChange={e => onUpdateSet(blockIdx, setIdx, 'reps', e.target.value)}
                placeholder="—"
                className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
              />
              <input
                type="number"
                inputMode="decimal"
                min="1"
                max="10"
                step="0.5"
                value={set.rpe}
                onChange={e => onUpdateSet(blockIdx, setIdx, 'rpe', e.target.value)}
                placeholder="—"
                className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
              />
              {(() => {
                const setTimerId: TimerId = { type: 'set', blockIdx, setIdx };
                const key = timerIdKey(setTimerId);
                const isSetActive = activeTimer !== null && timerIdKey(activeTimer.id) === key;
                return (
                  <ExerciseRestTimer
                    timerId={setTimerId}
                    defaultDuration={block.restSeconds}
                    variant="inline"
                    isActive={isSetActive}
                    remaining={isSetActive ? activeTimer!.remaining : 0}
                    totalDuration={isSetActive ? activeTimer!.duration : 0}
                    recordedRest={restRecords[key] ?? null}
                    onStart={onStartTimer}
                    onSkip={onSkipTimer}
                    onExtend={onExtendTimer}
                  />
                );
              })()}
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

            {/* Drop rows */}
            {set.drops?.map((drop, dropIdx) => (
              <div
                key={`drop-${setIdx}-${dropIdx}`}
                className={`grid grid-cols-[32px_1fr_1fr_1fr_42px_30px_36px] gap-1 items-center py-1.5 px-1 rounded-md ml-4 border-l-2 border-set-dropset/40 ${
                  drop.completed ? 'bg-primary/10' : ''
                }`}
              >
                <span className="text-xs font-bold text-set-dropset text-center">
                  {set.setNumber}D{superscripts[dropIdx] ?? `${dropIdx + 1}`}
                </span>
                <span className="text-xs text-muted-foreground text-center">—</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={drop.weight}
                  onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'weight', e.target.value)}
                  placeholder="—"
                  className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  value={drop.reps}
                  onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'reps', e.target.value)}
                  placeholder="—"
                  className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="10"
                  step="0.5"
                  value={drop.rpe}
                  onChange={e => onUpdateDrop(blockIdx, setIdx, dropIdx, 'rpe', e.target.value)}
                  placeholder="—"
                  className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                />
                {/* No timer for drop rows */}
                <span />
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
            ))}

            {/* Add Drop button for any set */}
            <button
              onClick={() => onAddDrop(blockIdx, setIdx)}
              className="ml-4 py-1 px-3 text-xs text-set-dropset/70 hover:text-set-dropset transition-colors"
            >
              + Add Dropset
            </button>
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