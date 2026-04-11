import React, { useState, useCallback, useMemo } from 'react';
import type { WorkoutTemplate, TemplateExercise, ExerciseId, SetType } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { Button } from '@/components/ui/button';
import { Plus, MoreHorizontal, Trash2, Layers, ChevronDown, ArrowUp, ArrowDown, Timer, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SetTypeBadge } from '@/components/SetTypeBadge';
import type { WeightUnit } from '@/hooks/useStorage';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';

interface TemplateBuilderProps {
  initial?: WorkoutTemplate;
  weightUnit?: WeightUnit;
  onSave: (template: WorkoutTemplate) => void;
  onCancel: () => void;
}

const setTypes: SetType[] = ['normal', 'superset', 'dropset', 'failure'];

interface TemplateSetRow {
  setNumber: number;
  targetWeight: string;
  targetReps: string;
  targetRpe: string;
}

interface TemplateBlock {
  exerciseId: ExerciseId;
  exerciseName: string;
  sets: TemplateSetRow[];
  setType: SetType;
  restSeconds: number;
}

function exerciseToBlock(ex: TemplateExercise, lookup?: Record<string, string>): TemplateBlock {
  const name = lookup?.[ex.exerciseId] ?? EXERCISES[ex.exerciseId]?.name ?? ex.exerciseId;
  return {
    exerciseId: ex.exerciseId,
    exerciseName: name,
    setType: ex.setType,
    restSeconds: ex.restSeconds,
    sets: Array.from({ length: ex.sets }, (_, i) => ({
      setNumber: i + 1,
      targetWeight: '',
      targetReps: ex.targetReps === 'failure' ? '' : ex.targetReps.toString(),
      targetRpe: ex.targetRpe?.toString() ?? '',
    })),
  };
}

function blockToExercise(block: TemplateBlock): TemplateExercise {
  const firstSet = block.sets[0];
  const reps = block.setType === 'failure' ? 'failure' as const : (parseInt(firstSet?.targetReps) || 10);
  return {
    exerciseId: block.exerciseId,
    sets: block.sets.length,
    targetReps: reps,
    setType: block.setType,
    restSeconds: block.restSeconds,
    targetRpe: firstSet?.targetRpe ? parseInt(firstSet.targetRpe) : undefined,
  };
}

const DRAFT_KEY = 'template_builder_draft';

function loadDraft(initialTemplate?: WorkoutTemplate): { name: string; blocks: TemplateBlock[] } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw);
      // Only restore if editing the same template (or both are new)
      if ((draft.id ?? null) === (initialTemplate?.id ?? null)) {
        return { name: draft.name ?? '', blocks: draft.blocks ?? [] };
      }
    }
  } catch { /* ignore corrupt data */ }
  return {
    name: initialTemplate?.name ?? '',
    blocks: initialTemplate?.exercises.map(ex => exerciseToBlock(ex)) ?? [],
  };
}

export const TemplateBuilder: React.FC<TemplateBuilderProps> = ({ initial, weightUnit = 'kg', onSave, onCancel }) => {
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

  const [name, setName] = useState(() => loadDraft(initial).name);
  const [blocks, setBlocks] = useState<TemplateBlock[]>(() => loadDraft(initial).blocks);
  const [showExercisePicker, setShowExercisePicker] = useState(false);

  // Cache draft to localStorage on every change
  React.useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: initial?.id ?? null, name, blocks }));
    } catch { /* quota exceeded, ignore */ }
  }, [name, blocks, initial?.id]);

  const updateSet = useCallback((blockIdx: number, setIdx: number, field: keyof TemplateSetRow, value: string) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      return {
        ...block,
        sets: block.sets.map((set, si) => si === setIdx ? { ...set, [field]: value } : set),
      };
    }));
  }, []);

  const addSet = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      const last = block.sets[block.sets.length - 1];
      return {
        ...block,
        sets: [...block.sets, {
          setNumber: block.sets.length + 1,
          targetWeight: last?.targetWeight ?? '',
          targetReps: last?.targetReps ?? '',
          targetRpe: last?.targetRpe ?? '',
        }],
      };
    }));
  }, []);

  const removeExercise = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.filter((_, i) => i !== blockIdx));
  }, []);

  const moveExercise = useCallback((from: number, to: number) => {
    setBlocks(prev => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const updateBlockType = useCallback((blockIdx: number, type: SetType) => {
    setBlocks(prev => prev.map((b, i) => i === blockIdx ? { ...b, setType: type } : b));
  }, []);

  const updateRestSeconds = useCallback((blockIdx: number, seconds: number) => {
    setBlocks(prev => prev.map((b, i) => i === blockIdx ? { ...b, restSeconds: seconds } : b));
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
          setType: 'normal' as SetType,
          restSeconds: 90,
          sets: Array.from({ length: 3 }, (_, i) => ({
            setNumber: i + 1,
            targetWeight: '',
            targetReps: '10',
            targetRpe: '',
          })),
        }));
      return [...prev, ...newBlocks];
    });
    setShowExercisePicker(false);
  }, []);

  const clearDraft = useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  const save = () => {
    if (!name.trim() || blocks.length === 0) return;
    clearDraft();
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      exercises: blocks.map(blockToExercise),
    });
  };

  const handleCancel = () => {
    clearDraft();
    onCancel();
  };

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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pb-2">
        <button onClick={handleCancel} className="text-sm text-muted-foreground hover:text-foreground">✕</button>
        <Button variant="neon" size="sm" onClick={save} disabled={!name.trim() || blocks.length === 0}>
          Save Template
        </Button>
      </div>

      {/* Template Name */}
      <div className="px-4 pb-3">
        <input
          type="text"
          placeholder="Template name..."
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-transparent text-xl font-bold text-foreground placeholder:text-muted-foreground/50 outline-none border-b border-border pb-2 focus:border-primary transition-colors"
        />
      </div>

      {/* Exercise Blocks */}
      <div className="flex-1 overflow-y-auto px-4 pb-24 space-y-2">
        {blocks.map((block, blockIdx) => (
          <div key={`${block.exerciseId}-${blockIdx}`} className="rounded-lg">
            {/* Exercise Header */}
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold text-primary">{block.exerciseName}</h3>
              <Popover>
                <PopoverTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground p-1">
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-48 p-1">
                  <button
                    onClick={() => moveExercise(blockIdx, blockIdx - 1)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-foreground hover:bg-secondary"
                  >
                    <ArrowUp className="w-4 h-4" /> Move Up
                  </button>
                  <button
                    onClick={() => moveExercise(blockIdx, blockIdx + 1)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-foreground hover:bg-secondary"
                  >
                    <ArrowDown className="w-4 h-4" /> Move Down
                  </button>
                  <button
                    onClick={() => removeExercise(blockIdx)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-4 h-4" /> Remove Exercise
                  </button>
                </PopoverContent>
              </Popover>
            </div>

            {/* Set Type Badges */}
            <div className="flex gap-1.5 flex-wrap mb-2">
              {setTypes.map(t => (
                <SetTypeBadge
                  key={t} type={t} selected={block.setType === t}
                  onClick={() => updateBlockType(blockIdx, t)}
                />
              ))}
            </div>

            {/* Rest Timer Setting */}
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground">
              <Timer className="w-3 h-3" />
              <span>Rest:</span>
              <input
                type="number"
                min={0}
                step={15}
                value={block.restSeconds}
                onChange={e => updateRestSeconds(blockIdx, parseInt(e.target.value) || 0)}
                className="w-16 text-center text-xs bg-secondary/60 rounded-md py-1 text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
              <span>sec</span>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-[32px_1fr_1fr_1fr] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
              <span>Set</span>
              <span className="text-center">{weightUnit}</span>
              <span className="text-center">Reps</span>
              <span className="text-center">RPE</span>
            </div>

            {/* Set Rows */}
            {block.sets.map((set, setIdx) => (
              <div
                key={setIdx}
                className="grid grid-cols-[32px_1fr_1fr_1fr] gap-1 items-center py-1.5 px-1 rounded-md"
              >
                <span className="text-xs font-bold text-muted-foreground text-center">{set.setNumber}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={set.targetWeight}
                  onChange={e => updateSet(blockIdx, setIdx, 'targetWeight', e.target.value)}
                  placeholder="—"
                  className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                />
                <input
                  type="number"
                  inputMode="numeric"
                  value={set.targetReps}
                  onChange={e => updateSet(blockIdx, setIdx, 'targetReps', e.target.value)}
                  placeholder={block.setType === 'failure' ? 'Fail' : '—'}
                  className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                />
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="10"
                  step="0.5"
                  value={set.targetRpe}
                  onChange={e => updateSet(blockIdx, setIdx, 'targetRpe', e.target.value)}
                  placeholder="—"
                  className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                />
              </div>
            ))}

            {/* Add Set */}
            <button
              onClick={() => addSet(blockIdx)}
              className="w-full py-2 mt-1 rounded-md bg-secondary/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
            >
              + Add Set
            </button>
          </div>
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
