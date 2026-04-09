import React from 'react';
import type { WorkoutSession } from '@/types/workout';

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
  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">←</button>
        <h2 className="text-xl font-bold text-foreground">Workout History</h2>
      </div>
      {sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No workouts yet. Start your first session!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => onSelectSession(s)}
              className="bg-card rounded-xl p-4 border border-border text-left hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-foreground">
                  {new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <span className="text-xs text-muted-foreground">{formatDuration(s.duration)}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span>{s.exercises.map(e => e.exerciseName).join(', ')}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                <span>{s.totalSets} sets</span>
                <span>{s.totalReps} reps</span>
                {s.averageRpe && <span className="text-primary">RPE {s.averageRpe.toFixed(1)}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
