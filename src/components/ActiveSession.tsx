import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { ExerciseId, ExerciseLog, SetType, WorkoutSet, WorkoutSession, TemplateExercise } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { CameraFeed } from '@/components/CameraFeed';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { Button } from '@/components/ui/button';
import { Check, Plus, MoreHorizontal } from 'lucide-react';

interface ActiveSessionProps {
  exercises: ExerciseId[];
  templateExercises?: TemplateExercise[];
  onFinish: (session: WorkoutSession) => void;
  onCancel: () => void;
}

interface SetRow {
  setNumber: number;
  weight: string;
  reps: string;
  completed: boolean;
  type: SetType;
  rpe?: number;
}

interface ExerciseBlock {
  exerciseId: ExerciseId;
  exerciseName: string;
  sets: SetRow[];
}

export const ActiveSession: React.FC<ActiveSessionProps> = ({ exercises: initialExercises, templateExercises, onFinish, onCancel }) => {
  const [blocks, setBlocks] = useState<ExerciseBlock[]>(() =>
    initialExercises.map((id, idx) => {
      const tpl = templateExercises?.[idx];
      const numSets = tpl?.sets ?? 3;
      return {
        exerciseId: id,
        exerciseName: EXERCISES[id]?.name ?? id,
        sets: Array.from({ length: numSets }, (_, i) => ({
          setNumber: i + 1,
          weight: '',
          reps: tpl?.targetReps === 'failure' ? '' : (tpl?.targetReps?.toString() ?? ''),
          completed: false,
          type: tpl?.setType ?? 'normal',
        })),
      };
    })
  );
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startTime = useRef(Date.now());

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
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      return {
        ...block,
        sets: block.sets.map((set, si) => {
          if (si !== setIdx) return set;
          return { ...set, completed: !set.completed };
        }),
      };
    }));
  }, []);

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
        }],
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
          sets: Array.from({ length: 3 }, (_, i) => ({
            setNumber: i + 1,
            weight: '',
            reps: '',
            completed: false,
            type: 'normal' as SetType,
          })),
        }));
      return [...prev, ...newBlocks];
    });
    setShowExercisePicker(false);
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
            rpe: s.rpe,
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

  if (showExercisePicker) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="p-4 pb-0">
          <Button variant="outline" onClick={() => setShowExercisePicker(false)} className="mb-2">← Back</Button>
        </div>
        <ExerciseSelector onSelect={addExercise} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
        <Button variant="neon" size="sm" onClick={finishWorkout}>Finish</Button>
      </div>

      {/* Title + Timer */}
      <div className="px-4 pb-3">
        <h1 className="text-xl font-bold text-foreground">Workout</h1>
        <p className="text-sm text-muted-foreground">{formatTime(elapsedSeconds)}</p>
      </div>

      {/* Camera */}
      <div className="px-4 pb-4">
        <CameraFeed />
      </div>

      {/* Exercise Blocks */}
      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-6">
        {blocks.map((block, blockIdx) => (
          <ExerciseTable
            key={block.exerciseId}
            block={block}
            blockIdx={blockIdx}
            onUpdateSet={updateSet}
            onToggleComplete={toggleSetComplete}
            onAddSet={addSet}
          />
        ))}

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
  onUpdateSet: (blockIdx: number, setIdx: number, field: keyof SetRow, value: string | boolean | number) => void;
  onToggleComplete: (blockIdx: number, setIdx: number) => void;
  onAddSet: (blockIdx: number) => void;
}

const ExerciseTable: React.FC<ExerciseTableProps> = ({ block, blockIdx, onUpdateSet, onToggleComplete, onAddSet }) => {
  return (
    <div>
      {/* Exercise Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-primary">{block.exerciseName}</h3>
        <button className="text-muted-foreground hover:text-foreground p-1">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-[40px_1fr_1fr_1fr_36px] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
        <span>Set</span>
        <span className="text-center">Previous</span>
        <span className="text-center">lbs</span>
        <span className="text-center">Reps</span>
        <span className="text-center">
          <Check className="w-3 h-3 mx-auto" />
        </span>
      </div>

      {/* Set Rows */}
      {block.sets.map((set, setIdx) => (
        <div
          key={setIdx}
          className={`grid grid-cols-[40px_1fr_1fr_1fr_36px] gap-1 items-center py-1.5 px-1 rounded-md ${
            set.completed ? 'bg-primary/10' : ''
          }`}
        >
          {/* Set Number */}
          <span className="text-xs font-bold text-muted-foreground text-center">{set.setNumber}</span>

          {/* Previous */}
          <span className="text-xs text-muted-foreground text-center">—</span>

          {/* Weight */}
          <input
            type="number"
            inputMode="decimal"
            value={set.weight}
            onChange={e => onUpdateSet(blockIdx, setIdx, 'weight', e.target.value)}
            placeholder="—"
            className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary"
          />

          {/* Reps */}
          <input
            type="number"
            inputMode="numeric"
            value={set.reps}
            onChange={e => onUpdateSet(blockIdx, setIdx, 'reps', e.target.value)}
            placeholder="—"
            className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary"
          />

          {/* Check */}
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
      ))}

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
