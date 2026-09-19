import React, { useMemo } from 'react';
import type { SharedCustomExercise, SharedExerciseMeta } from '@/types/share';
import type { WorkoutTemplate } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { formatWeightString, storedBandLevel } from '@/utils/weightConversion';
import { getBandLevelShortLabel, getExerciseInputMode, isDistanceBased, distanceUnitFromWeightUnit, fromMeters } from '@/utils/exerciseInputMode';
import { formatMmSs } from '@/utils/timeFormat';
import { resolveTemplateSupersets } from '@/utils/templateSupersets';
import { supersetInfo } from '@/types/activeSession';
import { SupersetBadge } from '@/components/SupersetBadge';

interface SharedTemplateViewProps {
  template: WorkoutTemplate;
  exerciseMeta: SharedExerciseMeta[];
  customExercises: SharedCustomExercise[];
  unit: WeightUnit;
  /** Rendered inside a program's day list, where the name is already a heading. */
  hideName?: boolean;
}

// Metres in the template, the viewer's unit on screen, and no trailing
// zeros: a 5 km target reads "5 km", not "5.00 km".
function formatTargetDistance(meters: number, unit: WeightUnit): string {
  const distanceUnit = distanceUnitFromWeightUnit(unit);
  return `${Number(fromMeters(meters, distanceUnit).toFixed(2))} ${distanceUnit}`;
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

  // The same resolution every editor and session runs, so an older template
  // that links by setType alone shows its pairs here too.
  const exercises = useMemo(
    () => resolveTemplateSupersets(template.exercises),
    [template.exercises],
  );

  const totalSets = exercises.reduce((sum, e) => sum + e.sets, 0);

  return (
    <div className="flex flex-col gap-3">
      {!hideName && (
        <div>
          <h2 className="text-xl font-extrabold text-foreground">{template.name}</h2>
          <p className="text-xs text-muted-foreground">
            {exercises.length} exercises · {totalSets} sets
          </p>
        </div>
      )}

      {exercises.length === 0 ? (
        <p className="text-sm text-muted-foreground">This template has no exercises.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {exercises.map((ex, i) => {
            const info = meta[ex.exerciseId];
            const superset = supersetInfo(exercises, i);
            const mode = getExerciseInputMode(ex.exerciseId, customLite);
            // Work measured by distance has no load column (every built-in run,
            // row and swim is time-distance), so its target is the distance.
            const target =
              isDistanceBased(mode)
                ? (ex.targetDistance == null ? null : formatTargetDistance(ex.targetDistance, unit))
                : ex.targetWeight == null
                  ? null
                  : mode === 'band'
                    ? getBandLevelShortLabel(storedBandLevel(ex.targetWeight))
                    : formatWeightString(ex.targetWeight, unit);

            return (
              <div
                key={`${ex.exerciseId}-${i}`}
                className={`rounded-xl p-3 border border-border ${superset ? superset.colorClass : 'bg-card'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span aria-hidden>{info?.icon ?? '🏋️'}</span>
                    <span className="font-semibold text-foreground truncate">
                      {info?.name ?? ex.exerciseId}
                    </span>
                  </div>
                  {superset && (
                    <div className="shrink-0">
                      <SupersetBadge info={superset} />
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs text-muted-foreground">
                  <span>
                    {ex.sets} × {ex.targetReps === 'failure' ? 'failure' : ex.targetReps}
                    {mode === 'time' || mode === 'time-distance' || mode === 'weight-time' ? ' (time)' : ''}
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
