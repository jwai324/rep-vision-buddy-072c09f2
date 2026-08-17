import React, { useMemo } from 'react';
import type { SharedCustomExercise, SharedExerciseMeta } from '@/types/share';
import type { WorkoutTemplate } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { formatWeightString } from '@/utils/weightConversion';
import { getBandLevelShortLabel, getExerciseInputMode } from '@/utils/exerciseInputMode';
import { formatMmSs } from '@/utils/timeFormat';

interface SharedTemplateViewProps {
  template: WorkoutTemplate;
  exerciseMeta: SharedExerciseMeta[];
  customExercises: SharedCustomExercise[];
  unit: WeightUnit;
  /** Rendered inside a program's day list, where the name is already a heading. */
  hideName?: boolean;
}

/**
 * Read-only render of a shared template. Everything comes from the snapshot —
 * no lookup hooks, no auth context — so this works for a logged-out viewer.
 */
export const SharedTemplateView: React.FC<SharedTemplateViewProps> = ({
  template, exerciseMeta, customExercises, unit, hideName,
}) => {
  const meta = useMemo(
    () => Object.fromEntries(exerciseMeta.map(m => [m.exerciseId, m])),
    [exerciseMeta],
  );

  // The shared custom-exercise definitions travel with the snapshot, so a
  // time-based custom exercise still reads as time here rather than falling
  // back to the reps-and-weight default.
  const customLite = useMemo(
    () => customExercises.map(c => ({
      id: c.sourceId,
      primaryBodyPart: c.primaryBodyPart,
      equipment: c.equipment,
      measurementType: c.measurementType,
    })),
    [customExercises],
  );

  const totalSets = template.exercises.reduce((sum, e) => sum + e.sets, 0);

  return (
    <div className="flex flex-col gap-3">
      {!hideName && (
        <div>
          <h2 className="text-xl font-extrabold text-foreground">{template.name}</h2>
          <p className="text-xs text-muted-foreground">
            {template.exercises.length} exercises · {totalSets} sets
          </p>
        </div>
      )}

      {template.exercises.length === 0 ? (
        <p className="text-sm text-muted-foreground">This template has no exercises.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {template.exercises.map((ex, i) => {
            const info = meta[ex.exerciseId];
            const mode = getExerciseInputMode(ex.exerciseId, customLite);
            const target =
              ex.targetWeight == null
                ? null
                : mode === 'band'
                  ? getBandLevelShortLabel(ex.targetWeight)
                  : formatWeightString(ex.targetWeight, unit);

            return (
              <div key={`${ex.exerciseId}-${i}`} className="bg-card rounded-xl p-3 border border-border">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span aria-hidden>{info?.icon ?? '🏋️'}</span>
                    <span className="font-semibold text-foreground truncate">
                      {info?.name ?? ex.exerciseId}
                    </span>
                  </div>
                  {ex.supersetGroup !== undefined && (
                    <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-set-superset/20 text-muted-foreground">
                      Superset {ex.supersetGroup}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                  <span>
                    {ex.sets} × {ex.targetReps === 'failure' ? 'failure' : ex.targetReps}
                    {mode === 'time' || mode === 'time-distance' ? ' (time)' : ''}
                  </span>
                  {target && <span>@ {target}</span>}
                  {ex.targetRpe != null && <span>RPE {ex.targetRpe}</span>}
                  <span>{formatMmSs(ex.restSeconds)} rest</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
