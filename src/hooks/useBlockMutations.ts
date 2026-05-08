import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import type { ExerciseId, SetType, WorkoutSession, TemplateExercise } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import type { ExerciseBlock, SetRow, DropRow, ActiveSessionCache, RunningSetState } from '@/types/activeSession';
import { getExerciseInputMode, isTimeBased, isDistanceBased, usesReps, usesWeight, toMeters } from '@/utils/exerciseInputMode';
import { canCompleteSet } from '@/utils/setValidation';
import type { WeightUnit } from '@/hooks/useStorage';
import type { Exercise } from '@/data/exercises';
import type { TimerId } from '@/components/ExerciseRestTimer';

/**
 * Normalize blocks restored from cache or built from saved sessions:
 * Parent rows must never be `type: 'dropset'`.
 */
export function normalizeBlocks(blocks: ExerciseBlock[]): ExerciseBlock[] {
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

interface UseBlockMutationsOptions {
  weightUnit: WeightUnit;
  defaultDropSetsEnabled: boolean;
  customExercises: (Exercise & { isCustom: true; isRecovery: boolean })[];
  startTimer: (id: TimerId, duration: number) => void;
}

export function useBlockMutations(
  blocks: ExerciseBlock[],
  setBlocks: React.Dispatch<React.SetStateAction<ExerciseBlock[]>>,
  { weightUnit, defaultDropSetsEnabled, customExercises, startTimer }: UseBlockMutationsOptions,
) {
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
          if (shouldCascade && si > setIdx && set.type !== 'warmup' && (set[field] === '' || set[field] === oldValue)) {
            return { ...set, [field]: value };
          }
          return set;
        }),
      };
    }));
  }, [setBlocks]);

  const toggleSetComplete = useCallback((blockIdx: number, setIdx: number) => {
    setBlocks(prev => {
      const block = prev[blockIdx];
      const set = block.sets[setIdx];
      const wasCompleted = set.completed;

      if (!wasCompleted) {
        const mode = getExerciseInputMode(block.exerciseId, customExercises);
        const isBodyweight = block.exerciseName.toLowerCase().includes('bodyweight') || (EXERCISES[block.exerciseId]?.name ?? '').toLowerCase().includes('bodyweight');
        const isCardio = isTimeBased(mode);
        if (!canCompleteSet(set.weight, set.reps, weightUnit, isBodyweight, isCardio, set.time, mode, set.distance)) {
          const errorMsg = isTimeBased(mode) ? 'Enter a time before completing this set.'
            : isDistanceBased(mode) ? 'Enter a distance before completing this set.'
            : mode === 'reps' ? 'Enter reps before completing this set.'
            : 'Enter valid weight and reps before completing this set.';
          toast.error(errorMsg);
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
            if (!wasCompleted && si > setIdx && !s.completed) {
              return {
                ...s,
                weight: s.weight || completedSet.weight,
                reps: s.reps || completedSet.reps,
                rpe: s.rpe || completedSet.rpe,
                time: s.time || completedSet.time,
                distance: s.distance || completedSet.distance,
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
  }, [setBlocks, startTimer, weightUnit, customExercises]);

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
  }, [setBlocks]);

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
  }, [setBlocks]);

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
  }, [setBlocks]);

  const removeSet = useCallback((blockIdx: number, setIdx: number) => {
    let deletedSet: SetRow | null = null;

    setBlocks(prev => {
      const block = prev[blockIdx];
      if (!block) return prev;
      deletedSet = { ...block.sets[setIdx] };

      return prev.map((b, bi) => {
        if (bi !== blockIdx) return b;
        const newSets = b.sets.filter((_, si) => si !== setIdx);
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
        return { ...b, sets: renumbered };
      });
    });

    if (deletedSet) {
      const captured = deletedSet;
      toast('Set deleted', {
        action: {
          label: 'Undo',
          onClick: () => {
            setBlocks(prev => prev.map((b, bi) => {
              if (bi !== blockIdx) return b;
              const restored = [...b.sets];
              restored.splice(setIdx, 0, captured);
              let warmupCount = 0;
              let normalCount = 0;
              const renumbered = restored.map(s => {
                if (s.type === 'warmup') { warmupCount++; return { ...s, setNumber: warmupCount }; }
                normalCount++; return { ...s, setNumber: normalCount };
              });
              return { ...b, sets: renumbered };
            }));
          },
        },
      });
    }
  }, [setBlocks]);

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
  }, [setBlocks]);

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
  }, [setBlocks, defaultDropSetsEnabled, exerciseLookup]);

  const removeExercise = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.filter((_, i) => i !== blockIdx));
  }, [setBlocks]);

  const toggleDropSets = useCallback((blockIdx: number) => {
    setBlocks(prev => prev.map((b, i) => {
      if (i !== blockIdx) return b;
      const nowEnabled = !b.dropSetsEnabled;
      if (!nowEnabled) {
        return {
          ...b,
          dropSetsEnabled: false,
          sets: b.sets.map(s => ({ ...s, drops: undefined })),
        };
      }
      return { ...b, dropSetsEnabled: true };
    }));
  }, [setBlocks]);

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
      const newSets = [warmupSet, ...block.sets];
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
  }, [setBlocks]);

  return {
    exerciseLookup,
    updateSet,
    toggleSetComplete,
    addSet,
    addDrop,
    updateDrop,
    removeSet,
    removeDrop,
    addExercise,
    addMultipleExercises,
    removeExercise,
    toggleDropSets,
    addWarmupSet,
  };
}
