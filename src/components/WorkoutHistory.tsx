import React, { useState, useMemo } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { WorkoutSession } from '@/types/workout';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';

interface WorkoutHistoryProps {
  sessions: WorkoutSession[];
  onSelectSession: (session: WorkoutSession) => void;
  onBack: () => void;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m} min`;
}

export const WorkoutHistory: React.FC<WorkoutHistoryProps> = ({ sessions, onSelectSession, onBack }) => {
  const exerciseLookup = useExerciseLookup();
  const [showRestDays, setShowRestDays] = useState(false);

  const filtered = useMemo(() => {
    if (showRestDays) return sessions;
    return sessions.filter(s => !s.isRestDay);
  }, [sessions, showRestDays]);

  const restDayCount = sessions.filter(s => s.isRestDay).length;

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">←</button>
        <h2 className="text-xl font-bold text-foreground flex-1">Workout History</h2>
        {restDayCount > 0 && (
          <button
            onClick={() => setShowRestDays(!showRestDays)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              showRestDays
                ? 'bg-primary/10 text-primary border border-primary/30'
                : 'bg-secondary text-muted-foreground border border-border'
            }`}
          >
            {showRestDays ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            Rest Days
          </button>
        )}
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No workouts yet. Start your first session!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(s => (
            <button
              key={s.id}
              onClick={() => onSelectSession(s)}
              className={`bg-card rounded-xl p-4 border text-left transition-colors ${
                s.isRestDay
                  ? 'border-border/50 opacity-80 hover:opacity-100 hover:border-primary/20'
                  : 'border-border hover:border-primary/30'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {s.isRestDay && <span className="text-base">😴</span>}
                  <span className="text-sm font-semibold text-foreground">
                    {new Date(s.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                  {s.isRestDay && (
                    <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                      Rest Day
                    </span>
                  )}
                </div>
                {!s.isRestDay && (
                  <span className="text-xs text-muted-foreground">{formatDuration(s.duration)}</span>
                )}
              </div>
              {s.isRestDay ? (
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {s.recoveryActivities && s.recoveryActivities.length > 0 ? (
                    <span>
                      {s.recoveryActivities.map(a => {
                        return exerciseLookup[a.activityId] ?? a.activityId;
                      }).join(', ')}
                    </span>
                  ) : (
                    <span>Recovery day</span>
                  )}
                  {s.recoveryActivities && (
                    <span className="text-primary">
                      {s.recoveryActivities.filter(a => a.completed).length}/{s.recoveryActivities.length} done
                    </span>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{s.exercises.map(e => e.exerciseName).join(', ')}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                    <span>{s.totalSets} sets</span>
                    <span>{s.totalReps} reps</span>
                    {s.averageRpe && <span className="text-primary">RPE {s.averageRpe.toFixed(1)}</span>}
                  </div>
                </>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};