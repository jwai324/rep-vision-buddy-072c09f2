import React, { useState, useCallback, useMemo } from 'react';
import type { WorkoutTemplate, TemplateExercise, ExerciseId, SetType } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { Button } from '@/components/ui/button';
import { Plus, MoreHorizontal, Trash2, Timer, ArrowLeftRight, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SetTypeBadge } from '@/components/SetTypeBadge';
import type { WeightUnit } from '@/hooks/useStorage';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { getExerciseInputMode, BAND_LEVELS } from '@/utils/exerciseInputMode';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableExerciseItem } from '@/components/SortableExerciseItem';

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
  const [swapTarget, setSwapTarget] = useState<number | null>(null); // blockIdx being swapped

  // Re-resolve exercise names when custom exercises load
  React.useEffect(() => {
    setBlocks(prev => prev.map(b => ({
      ...b,
      exerciseName: exerciseLookup[b.exerciseId] ?? b.exerciseName,
    })));
  }, [exerciseLookup]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
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
  }, [exerciseLookup]);

  const swapExercise = useCallback((blockIdx: number, newId: ExerciseId) => {
    setBlocks(prev => prev.map((b, i) => {
      if (i !== blockIdx) return b;
      return { ...b, exerciseId: newId, exerciseName: exerciseLookup[newId] ?? newId };
    }));
    setSwapTarget(null);
  }, [exerciseLookup]);

  const allExercises = useMemo(() => [...EXERCISE_DATABASE, ...customExercises], [customExercises]);

  const getSimilarExercises = useCallback((exerciseId: ExerciseId) => {
    const current = allExercises.find(e => e.id === exerciseId);
    if (!current) return [];
    const usedIds = new Set(blocks.map(b => b.exerciseId));
    return allExercises
      .filter(e => e.id !== exerciseId && !usedIds.has(e.id) && e.primaryBodyPart === current.primaryBodyPart)
      .sort((a, b) => {
        // Prioritize same movement pattern, then same equipment
        const aPattern = a.movementPattern === current.movementPattern ? 0 : 1;
        const bPattern = b.movementPattern === current.movementPattern ? 0 : 1;
        if (aPattern !== bPattern) return aPattern - bPattern;
        const aEquip = a.equipment === current.equipment ? 0 : 1;
        const bEquip = b.equipment === current.equipment ? 0 : 1;
        if (aEquip !== bEquip) return aEquip - bEquip;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 8);
  }, [allExercises, blocks]);

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
    const isSwapMode = swapTarget !== null;
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="p-4 pb-0">
          <Button variant="outline" onClick={() => { setShowExercisePicker(false); setSwapTarget(null); }} className="mb-2">← Back</Button>
        </div>
        <ExerciseSelector
          onSelect={(id) => {
            if (isSwapMode) {
              swapExercise(swapTarget, id);
              setShowExercisePicker(false);
            } else {
              addExercise(id);
            }
          }}
          onSelectMultiple={isSwapMode ? undefined : addMultipleExercises}
          multiSelect={!isSwapMode}
        />
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
          <SortableContext items={blocks.map(b => b.exerciseId)} strategy={verticalListSortingStrategy}>
            {blocks.map((block, blockIdx) => (
              <SortableExerciseItem key={block.exerciseId} id={block.exerciseId}>
                <div className="rounded-lg">
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
                          onClick={() => setSwapTarget(blockIdx)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-foreground hover:bg-secondary"
                        >
                          <ArrowLeftRight className="w-4 h-4" /> Swap Exercise
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

                  {/* Swap Panel */}
                  {swapTarget === blockIdx && (
                    <div className="bg-secondary/50 rounded-lg border border-border p-3 mb-2">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Similar Exercises</p>
                        <button onClick={() => setSwapTarget(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
                      </div>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {getSimilarExercises(block.exerciseId).map(ex => (
                          <button
                            key={ex.id}
                            onClick={() => swapExercise(blockIdx, ex.id)}
                            className="w-full text-left px-2.5 py-2 rounded-md hover:bg-primary/10 transition-colors flex items-center justify-between"
                          >
                            <div>
                              <span className="text-sm font-medium text-foreground">{ex.name}</span>
                              <span className="text-[10px] text-muted-foreground ml-2">{ex.equipment}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => { setShowExercisePicker(true); }}
                        className="w-full mt-2 py-2 rounded-md border border-dashed border-muted-foreground/30 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Search className="w-3 h-3" /> Browse All Exercises
                      </button>
                    </div>
                  )}

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

                  {/* Table Header & Set Rows — mode aware */}
                  {(() => {
                    const mode = getExerciseInputMode(block.exerciseId, customExercises);
                    return (
                      <>
                        {mode === 'cardio' ? (
                          <div className="grid grid-cols-[32px_1fr_1fr] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
                            <span>Set</span>
                            <span className="text-center">Time (min)</span>
                            <span className="text-center">RPE</span>
                          </div>
                        ) : mode === 'band' ? (
                          <div className="grid grid-cols-[32px_1fr_1fr_1fr] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
                            <span>Set</span>
                            <span className="text-center">Band</span>
                            <span className="text-center">Reps</span>
                            <span className="text-center">RPE</span>
                          </div>
                        ) : (
                          <div className="grid grid-cols-[32px_1fr_1fr_1fr] gap-1 text-xs font-medium text-muted-foreground mb-1 px-1">
                            <span>Set</span>
                            <span className="text-center">{weightUnit}</span>
                            <span className="text-center">Reps</span>
                            <span className="text-center">RPE</span>
                          </div>
                        )}

                        {block.sets.map((set, setIdx) => (
                          <div
                            key={setIdx}
                            className={`grid ${mode === 'cardio' ? 'grid-cols-[32px_1fr_1fr]' : 'grid-cols-[32px_1fr_1fr_1fr]'} gap-1 items-center py-1.5 px-1 rounded-md`}
                          >
                            <span className="text-xs font-bold text-muted-foreground text-center">{set.setNumber}</span>
                            {mode === 'cardio' ? (
                              <input
                                type="number"
                                inputMode="decimal"
                                value={set.targetReps}
                                onChange={e => updateSet(blockIdx, setIdx, 'targetReps', e.target.value)}
                                placeholder="min"
                                className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                              />
                            ) : mode === 'band' ? (
                              <select
                                value={set.targetWeight}
                                onChange={e => updateSet(blockIdx, setIdx, 'targetWeight', e.target.value)}
                                className="w-full text-center text-xs bg-secondary/60 rounded-md py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer"
                              >
                                <option value="">—</option>
                                {BAND_LEVELS.map(b => (
                                  <option key={b.level} value={b.level.toString()}>{b.label}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="number"
                                inputMode="decimal"
                                value={set.targetWeight}
                                onChange={e => updateSet(blockIdx, setIdx, 'targetWeight', e.target.value)}
                                placeholder="—"
                                className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                              />
                            )}
                            {mode !== 'cardio' && (
                              <input
                                type="number"
                                inputMode="numeric"
                                value={set.targetReps}
                                onChange={e => updateSet(blockIdx, setIdx, 'targetReps', e.target.value)}
                                placeholder={block.setType === 'failure' ? 'Fail' : '—'}
                                className="w-full text-center text-sm bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto"
                              />
                            )}
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
                      </>
                    );
                  })()}

                  {/* Add Set */}
                  <button
                    onClick={() => addSet(blockIdx)}
                    className="w-full py-2 mt-1 rounded-md bg-secondary/40 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                  >
                    + Add Set
                  </button>
                </div>
              </SortableExerciseItem>
            ))}
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
    </div>
  );
};
