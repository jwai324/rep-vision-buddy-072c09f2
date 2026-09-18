import React, { useState, useCallback, useMemo } from 'react';
import type { ExerciseId, SetType } from '@/types/workout';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { Button } from '@/components/ui/button';
import { Plus, MoreHorizontal, Trash2, Timer, RefreshCw, Search, Layers } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SupersetBadge } from '@/components/SupersetBadge';
import { RpePickerButton } from '@/components/ExerciseTableComponent';
import type { WeightUnit } from '@/hooks/useStorage';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { getExerciseInputMode, BAND_LEVELS, getBandLevelLabel, isTimeBased, usesReps, usesWeight, type ExerciseInputMode } from '@/utils/exerciseInputMode';
import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableExerciseItem } from '@/components/SortableExerciseItem';
import { SupersetLinker } from '@/components/SupersetLinker';
import { supersetInfo } from '@/types/activeSession';
import { groupAdjacentSupersets, withoutLoneSupersets } from '@/utils/templateSupersets';
import type { TemplateBlock, TemplateSetRow } from '@/utils/templateBlocks';

/** A hold takes a load next to its duration; distance work never does. */
const isLoadedHold = (mode: ExerciseInputMode) => mode === 'time' || mode === 'weight-time';

export type BlocksUpdate = (prev: TemplateBlock[]) => TemplateBlock[];

const EMPTY_ROW: TemplateSetRow = { setNumber: 1, targetWeight: '', targetReps: '', targetRpe: '' };

interface TemplateExerciseEditorProps {
  blocks: TemplateBlock[];
  /**
   * Functional updates only: every edit is expressed against the latest list,
   * so an owner holding several templates' drafts can route it to the right one.
   */
  onChange: (update: BlocksUpdate) => void;
  weightUnit?: WeightUnit;
  defaultRestSeconds?: number;
  /** Keeps the RPE pickers' element ids apart when several editors share a page. */
  idPrefix?: string;
}

// The editor shows an exercise the way a live workout does, so it offers no
// per-exercise set-type pills: a superset is a link made in the linker, and
// dropsets and to-failure work are decided set by set while training. Whatever
// set type a block already carries is round-tripped untouched.

/**
 * The exercise list of a template, editable in place. It owns no template
 * state of its own — the blocks come from the owner and every edit goes back
 * through `onChange` — which is what lets the program editor show one draft in
 * two day tiles. The exercise picker and the superset linker cover the screen
 * while open, so the editor can sit inside a tile as well as on a page of its own.
 *
 * Exercise names are resolved through the library lookup at render time rather
 * than written back into the blocks: an effect that rewrote them would count as
 * an edit to an owner that treats any change as "unsaved".
 */
export const TemplateExerciseEditor: React.FC<TemplateExerciseEditorProps> = ({
  blocks, onChange, weightUnit = 'kg', defaultRestSeconds = 90, idPrefix = 'template',
}) => {
  const { exercises: customExercises } = useCustomExercisesContext();
  const exerciseLookup = useExerciseLookup();
  const nameOf = useCallback(
    (block: TemplateBlock) => exerciseLookup[block.exerciseId] ?? block.exerciseName,
    [exerciseLookup],
  );

  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [swapTarget, setSwapTarget] = useState<number | null>(null); // blockIdx being swapped
  const [showSupersetLinker, setShowSupersetLinker] = useState(false);

  const handleSupersetSave = useCallback((groups: Record<string, number | undefined>) => {
    onChange(prev => groupAdjacentSupersets(
      withoutLoneSupersets(prev.map(b => ({ ...b, supersetGroup: groups[b.exerciseId] }))),
    ));
    setShowSupersetLinker(false);
  }, [onChange]);

  // A template holds one target per exercise (`TemplateExercise` has a set
  // count next to a single reps/weight/RPE), and only `sets[0]` is read on
  // save. The editor therefore shows one row and writes every edit to every
  // row, so the rows can never say something the saved template will not.
  const updateSet = useCallback((blockIdx: number, field: keyof TemplateSetRow, value: string) => {
    onChange(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      const rows = block.sets.length > 0 ? block.sets : [EMPTY_ROW];
      return { ...block, sets: rows.map(set => ({ ...set, [field]: value })) };
    }));
  }, [onChange]);

  const setSetCount = useCallback((blockIdx: number, count: number) => {
    onChange(prev => prev.map((block, bi) => {
      if (bi !== blockIdx) return block;
      const target = Math.max(1, count);
      const model = block.sets[0] ?? EMPTY_ROW;
      return {
        ...block,
        sets: Array.from({ length: target }, (_, i) => ({ ...(block.sets[i] ?? model), setNumber: i + 1 })),
      };
    }));
  }, [onChange]);

  const removeExercise = useCallback((blockIdx: number) => {
    onChange(prev => withoutLoneSupersets(prev.filter((_, i) => i !== blockIdx)));
  }, [onChange]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onChange(prev => {
      const oldIndex = prev.findIndex(b => b.exerciseId === active.id);
      const newIndex = prev.findIndex(b => b.exerciseId === over.id);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, [onChange]);

  const updateRestSeconds = useCallback((blockIdx: number, seconds: number) => {
    onChange(prev => prev.map((b, i) => i === blockIdx ? { ...b, restSeconds: seconds } : b));
  }, [onChange]);

  const addMultipleExercises = useCallback((ids: ExerciseId[]) => {
    onChange(prev => {
      const existingIds = new Set(prev.map(b => b.exerciseId));
      const newBlocks = ids
        .filter(id => !existingIds.has(id))
        .map(id => ({
          exerciseId: id,
          exerciseName: exerciseLookup[id] ?? id,
          setType: 'normal' as SetType,
          restSeconds: defaultRestSeconds,
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
  }, [onChange, exerciseLookup, defaultRestSeconds]);

  const addExercise = useCallback((id: ExerciseId) => {
    addMultipleExercises([id]);
  }, [addMultipleExercises]);

  const swapExercise = useCallback((blockIdx: number, newId: ExerciseId) => {
    onChange(prev => prev.map((b, i) => {
      if (i !== blockIdx) return b;
      return { ...b, exerciseId: newId, exerciseName: exerciseLookup[newId] ?? newId };
    }));
    setSwapTarget(null);
  }, [onChange, exerciseLookup]);

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

  if (showExercisePicker) {
    const isSwapMode = swapTarget !== null;
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col min-w-0">
        <div className="p-4 pb-0 shrink-0">
          <Button variant="outline" onClick={() => { setShowExercisePicker(false); setSwapTarget(null); }} className="mb-2">← Back</Button>
        </div>
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
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
      </div>
    );
  }

  if (showSupersetLinker) {
    return (
      <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
        <SupersetLinker
          exercises={blocks.map(b => ({
            exerciseId: b.exerciseId,
            exerciseName: nameOf(b),
            supersetGroup: b.supersetGroup,
          }))}
          onSave={handleSupersetSave}
          onCancel={() => setShowSupersetLinker(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
        <SortableContext items={blocks.map(b => b.exerciseId)} strategy={verticalListSortingStrategy}>
          {blocks.map((block, blockIdx) => {
            const superset = supersetInfo(blocks, blockIdx);
            const mode = getExerciseInputMode(block.exerciseId, customExercises);
            const showWeight = usesWeight(mode);
            const showReps = usesReps(mode);
            const isTime = isTimeBased(mode);
            // A hold carries two inputs that aren't weight+reps, so it doesn't
            // fit the boolean tally below.
            const isWeightTime = isLoadedHold(mode);
            const headerColCount = isWeightTime ? 3 : [showWeight || isTime, showReps, true].filter(Boolean).length; // inputs + rpe
            const headerCols = headerColCount === 3 ? 'grid-cols-[1fr_1fr_42px]' : 'grid-cols-[1fr_42px]';
            const headerLabels = (() => {
              switch (mode) {
                case 'time-distance': return ['Time (min)', 'RPE'];
                case 'time':
                case 'weight-time': return [weightUnit, 'Time (min)', 'RPE'];
                case 'distance': return ['Dist (km)', 'RPE'];
                case 'band': return ['Band', 'Reps', 'RPE'];
                default: return [weightUnit, 'Reps', 'RPE'];
              }
            })();
            const rowColCount = isWeightTime ? 3 : [showWeight || isTime || mode === 'distance', showReps && (showWeight || isTime || mode === 'distance'), true].filter(Boolean).length;
            const rowCols = rowColCount === 3 ? 'grid-cols-[1fr_1fr_42px]' : 'grid-cols-[1fr_42px]';
            const inputClass = 'w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary [&::-webkit-inner-spin-button]:appearance-auto';
            const stepClass = 'w-8 h-8 rounded-md bg-secondary/60 text-base leading-none text-foreground hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-secondary/60';
            // Every row carries the same target, so the first stands for all of
            // them; a block with no rows yet shows a blank one.
            const row = block.sets[0] ?? EMPTY_ROW;
            const setCount = block.sets.length;

            return (
              <SortableExerciseItem key={block.exerciseId} id={block.exerciseId}>
                <div className={`rounded-lg ${superset?.colorClass ?? ''} ${superset ? 'p-2' : ''}`}>
                  {superset && (
                    <div className="mb-1">
                      <SupersetBadge info={superset} onClick={() => setShowSupersetLinker(true)} />
                    </div>
                  )}

                  {/* Exercise Header */}
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <h3 className="text-sm font-semibold text-primary truncate">{nameOf(block)}</h3>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button className="text-muted-foreground hover:text-foreground p-1 shrink-0" aria-label={`Options for ${nameOf(block)}`}>
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-48 p-1">
                        <button
                          onClick={() => setSwapTarget(blockIdx)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-foreground hover:bg-secondary"
                        >
                          <RefreshCw className="w-4 h-4" /> Replace Exercise
                        </button>
                        <button
                          onClick={() => setShowSupersetLinker(true)}
                          disabled={blocks.length < 2}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md text-foreground hover:bg-secondary disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          <Layers className="w-4 h-4" /> Create Superset
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

                  {/* Table Header & the one target row — mode aware */}
                  <div className={`grid ${headerCols} gap-1 text-xs font-medium text-muted-foreground mb-1 px-1`}>
                    {headerLabels.map((h, idx) => (
                      <span key={idx} className="text-center">{h}</span>
                    ))}
                  </div>

                  <div className={`grid ${rowCols} gap-1 items-center py-1.5 px-1 rounded-md`}>
                    {isWeightTime ? (
                      <>
                        <input type="number" inputMode="decimal" value={row.targetWeight}
                          onChange={e => updateSet(blockIdx, 'targetWeight', e.target.value)} placeholder="—"
                          className={inputClass} />
                        <input type="number" inputMode="decimal" value={row.targetReps}
                          onChange={e => updateSet(blockIdx, 'targetReps', e.target.value)} placeholder="min"
                          className={inputClass} />
                      </>
                    ) : isTime ? (
                      <input type="number" inputMode="decimal" value={row.targetReps}
                        onChange={e => updateSet(blockIdx, 'targetReps', e.target.value)} placeholder="min"
                        className={inputClass} />
                    ) : mode === 'distance' ? (
                      <input type="number" inputMode="decimal" value={row.targetWeight}
                        onChange={e => updateSet(blockIdx, 'targetWeight', e.target.value)} placeholder="km"
                        className={inputClass} />
                    ) : mode === 'band' ? (
                      <select value={row.targetWeight}
                        onChange={e => updateSet(blockIdx, 'targetWeight', e.target.value)}
                        className="w-full text-center text-base bg-secondary/60 rounded-md py-1.5 text-foreground outline-none focus:ring-1 focus:ring-primary appearance-none cursor-pointer">
                        <option value="">—</option>
                        {BAND_LEVELS.map(b => (<option key={b.level} value={b.level.toString()}>{getBandLevelLabel(b.level, weightUnit)}</option>))}
                      </select>
                    ) : (
                      <input type="number" inputMode="decimal" value={row.targetWeight}
                        onChange={e => updateSet(blockIdx, 'targetWeight', e.target.value)} placeholder="—"
                        className={inputClass} />
                    )}
                    {showReps && !isTime && mode !== 'distance' && (
                      <input type="number" inputMode="numeric" value={row.targetReps}
                        onChange={e => updateSet(blockIdx, 'targetReps', e.target.value)}
                        placeholder={row.targetReps.trim() === '' ? 'Fail' : '—'}
                        className={inputClass} />
                    )}
                    <RpePickerButton
                      id={`${idPrefix}-rpe-${blockIdx}`}
                      value={row.targetRpe}
                      onChange={v => updateSet(blockIdx, 'targetRpe', v)}
                    />
                  </div>

                  {/* Set count */}
                  <div className="flex items-center justify-between mt-1 px-1">
                    <span className="text-xs font-medium text-muted-foreground">Sets</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSetCount(blockIdx, setCount - 1)}
                        disabled={setCount <= 1}
                        aria-label={`Remove a set from ${nameOf(block)}`}
                        className={stepClass}
                      >
                        −
                      </button>
                      <span data-testid="set-count" className="min-w-[3.5rem] text-center text-sm font-semibold text-foreground tabular-nums">
                        {setCount} {setCount === 1 ? 'set' : 'sets'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSetCount(blockIdx, setCount + 1)}
                        aria-label={`Add a set to ${nameOf(block)}`}
                        className={stepClass}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </SortableExerciseItem>
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

      {/* Out in the open rather than only behind an exercise's menu: linking
          is how a superset is made, and a template that never shows the door
          reads as if it cannot hold one. */}
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
  );
};
