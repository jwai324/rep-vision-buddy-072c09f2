import React from 'react';
import type { ExerciseLog } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { getExerciseInputMode, isTimeBased, isDistanceBased, formatDistance, distanceUnitFromWeightUnit } from '@/utils/exerciseInputMode';
import { formatMmSs } from '@/utils/timeFormat';

interface WorkoutLogProps {
  logs: ExerciseLog[];
  weightUnit?: WeightUnit;
}

export const WorkoutLog: React.FC<WorkoutLogProps> = ({ logs, weightUnit = 'kg' }) => {
  const distanceUnit = distanceUnitFromWeightUnit(weightUnit);
  const hasAnyData = logs.some(l => l.sets.length > 0);
  if (!hasAnyData) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-3 mx-4 mt-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Workout Log</h3>
      <div className="space-y-1.5">
        {logs.filter(l => l.sets.length > 0).map((log, i) => {
          const mode = getExerciseInputMode(log.exerciseId);
          const totalSeconds = log.sets.reduce((s, set) => s + (set.time ?? 0), 0);
          const totalDistance = log.sets.reduce((s, set) => s + (set.distance ?? 0), 0);
          return (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-foreground font-medium">{log.exerciseName}</span>
              <span className="text-muted-foreground text-xs">
                {isTimeBased(mode) ? (
                  <>
                    {formatMmSs(totalSeconds)}
                    {isDistanceBased(mode) && totalDistance > 0 && <> · {formatDistance(totalDistance, distanceUnit)}</>}
                  </>
                ) : mode === 'distance' ? (
                  <>{totalDistance > 0 ? formatDistance(totalDistance, distanceUnit) : '—'}</>
                ) : mode === 'reps' ? (
                  <>{log.sets.length} set{log.sets.length !== 1 ? 's' : ''} · {log.sets.reduce((s, set) => s + set.reps, 0)} reps</>
                ) : mode === 'band' ? (
                  <>{log.sets.length} set{log.sets.length !== 1 ? 's' : ''} · {log.sets.reduce((s, set) => s + set.reps, 0)} reps</>
                ) : (
                  <>
                    {log.sets.length} set{log.sets.length !== 1 ? 's' : ''} · {log.sets.reduce((s, set) => s + set.reps, 0)} reps
                    {log.sets.some(s => s.weight) && (
                      <> · {log.sets.map(s => s.weight ? `${s.weight}${weightUnit}` : '—').join(', ')}</>
                    )}
                    {totalSeconds > 0 && <> · {formatMmSs(totalSeconds)}</>}
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
