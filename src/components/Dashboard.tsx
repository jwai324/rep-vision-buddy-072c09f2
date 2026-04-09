import React from 'react';
import type { WorkoutSession, WorkoutProgram, WorkoutTemplate } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { Button } from '@/components/ui/button';

interface DashboardProps {
  history: WorkoutSession[];
  activeProgram: WorkoutProgram | null;
  templates: WorkoutTemplate[];
  onStartWorkout: () => void;
  onStartTemplate: (template: WorkoutTemplate) => void;
  onGoToHistory: () => void;
  onGoToTemplates: () => void;
  onGoToPrograms: () => void;
}

function getStreak(sessions: WorkoutSession[]): number {
  if (sessions.length === 0) return 0;
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dayStr = d.toDateString();
    const hasWorkout = sessions.some(s => new Date(s.date).toDateString() === dayStr);
    if (hasWorkout) streak++;
    else if (i > 0) break; // Allow today to not have a workout yet
    else continue;
  }
  return streak;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m} min`;
}

export const Dashboard: React.FC<DashboardProps> = ({
  history, activeProgram, templates, onStartWorkout, onStartTemplate, onGoToHistory, onGoToTemplates, onGoToPrograms
}) => {
  const streak = getStreak(history);
  const lastSession = history[0];

  // Determine today's template from active program
  const dayOfWeek = new Date().getDay(); // 0=Sun
  const todayDay = activeProgram?.days[(dayOfWeek + 6) % 7]; // Mon=0
  const todayTemplate = todayDay && todayDay.templateId !== 'rest'
    ? templates.find(t => t.id === todayDay.templateId)
    : null;

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">RepLog</h1>
          <p className="text-sm text-muted-foreground">AI-Powered Workout Tracker</p>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-2xl">🔥</span>
          <span className="font-mono text-xl font-bold text-primary">{streak}</span>
        </div>
      </div>

      {/* Active program today */}
      {todayTemplate && (
        <div className="bg-card rounded-xl p-4 border border-primary/30 glow-green">
          <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Today's Workout</p>
          <h3 className="font-semibold text-foreground mb-1">{todayTemplate.name}</h3>
          <p className="text-xs text-muted-foreground mb-3">
            {todayTemplate.exercises.map(e => EXERCISES[e.exerciseId].name).join(' → ')}
          </p>
          <Button variant="neon" size="sm" onClick={() => onStartTemplate(todayTemplate)}>
            Start Today's Workout
          </Button>
        </div>
      )}

      {todayDay?.templateId === 'rest' && activeProgram && (
        <div className="bg-card rounded-xl p-4 border border-border text-center">
          <span className="text-2xl">🛏️</span>
          <p className="text-sm text-muted-foreground mt-1">Rest day — recover and grow!</p>
        </div>
      )}

      {/* Last session */}
      {lastSession && (
        <div className="bg-card rounded-xl p-4 border border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2">Last Session</p>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {lastSession.exercises.map(e => e.exerciseName).join(', ')}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {lastSession.totalSets} sets · {lastSession.totalReps} reps · {formatDuration(lastSession.duration)}
              </p>
            </div>
            {lastSession.averageRpe && (
              <span className="text-sm font-bold text-primary">RPE {lastSession.averageRpe.toFixed(1)}</span>
            )}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <Button variant="neon" size="lg" onClick={onStartWorkout} className="w-full text-lg font-bold">
        🎯 Start Workout
      </Button>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Templates', icon: '📋', onClick: onGoToTemplates },
          { label: 'Programs', icon: '📅', onClick: onGoToPrograms },
          { label: 'History', icon: '📊', onClick: onGoToHistory },
        ].map(item => (
          <button
            key={item.label}
            onClick={item.onClick}
            className="bg-card rounded-xl p-4 flex flex-col items-center gap-2 border border-border hover:border-primary/30 transition-colors"
          >
            <span className="text-2xl">{item.icon}</span>
            <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
          </button>
        ))}
      </div>

      {/* History preview */}
      {history.length > 1 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Recent</p>
            <button onClick={onGoToHistory} className="text-xs text-primary hover:underline">View All</button>
          </div>
          <div className="flex flex-col gap-2">
            {history.slice(1, 4).map(s => (
              <div key={s.id} className="bg-card rounded-lg p-3 border border-border flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-foreground">
                    {new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{s.exercises.map(e => e.exerciseName).join(', ')}</p>
                </div>
                <span className="text-xs text-muted-foreground">{s.totalSets}s · {s.totalReps}r</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
