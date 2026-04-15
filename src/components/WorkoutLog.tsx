import React from 'react';
import type { ExerciseLog } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { getExerciseInputMode, formatSetDisplay } from '@/utils/exerciseInputMode';

interface WorkoutLogProps {
  logs: ExerciseLog[];
  weightUnit?: WeightUnit;
}

export const WorkoutLog: React.FC<WorkoutLogProps> = ({ logs, weightUnit = 'kg' }) => {
  const hasAnyData = logs.some(l => l.sets.length > 0);
  if (!hasAnyData) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-3 mx-4 mt-4">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Workout Log</h3>
      <div className="space-y-1.5">
        {logs.filter(l => l.sets.length > 0).map((log, i) => {
          const mode = getExerciseInputMode(log.exerciseId);
          return (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-foreground font-medium">{log.exerciseName}</span>
              <span className="text-muted-foreground text-xs">
                {mode === 'cardio' ? (
                  <>{log.sets.reduce((s, set) => s + (set.time ?? 0), 0)} min</>
                ) : mode === 'band' ? (
                  <>{log.sets.length} set{log.sets.length !== 1 ? 's' : ''} · {log.sets.reduce((s, set) => s + set.reps, 0)} reps</>
                ) : (
                  <>
                    {log.sets.length} set{log.sets.length !== 1 ? 's' : ''} · {log.sets.reduce((s, set) => s + set.reps, 0)} reps
                    {log.sets.some(s => s.weight) && (
                      <> · {log.sets.map(s => s.weight ? `${s.weight}${weightUnit}` : '—').join(', ')}</>
                    )}
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
