import React, { useState, useMemo } from 'react';
import { ArrowLeft, ChevronRight, Eye, EyeOff } from 'lucide-react';
import type { WorkoutSession, WorkoutTemplate, FutureWorkout } from '@/types/workout';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';

interface ActivityScreenProps {
  history: WorkoutSession[];
  futureWorkouts: FutureWorkout[];
  templates: WorkoutTemplate[];
  onSelectSession: (session: WorkoutSession) => void;
  onSelectFutureWorkout: (fw: FutureWorkout) => void;
  onBack: () => void;
  initialTab?: 'history' | 'future';
  filterDate?: string;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m} min`;
}

export const ActivityScreen: React.FC<ActivityScreenProps> = ({
  history, futureWorkouts, templates, onSelectSession, onSelectFutureWorkout, onBack, initialTab = 'future', filterDate,
}) => {
  const exerciseLookup = useExerciseLookup();
  const [tab, setTab] = useState<'history' | 'future'>(initialTab);
  const [showRestDays, setShowRestDays] = useState(!!filterDate);

  const filteredHistory = useMemo(() => {
    let items = showRestDays ? history : history.filter(s => !s.isRestDay);
    if (filterDate) items = items.filter(s => s.date.startsWith(filterDate));
    return items;
  }, [history, showRestDays, filterDate]);

  const filteredFuture = useMemo(() => {
    let items = showRestDays ? futureWorkouts : futureWorkouts.filter(fw => fw.templateId !== 'rest');
    if (filterDate) items = items.filter(f => f.date === filterDate);
    return items;
  }, [futureWorkouts, showRestDays, filterDate]);

  const restCount = history.filter(s => s.isRestDay).length + futureWorkouts.filter(f => f.templateId === 'rest').length;

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-extrabold text-foreground">Activity</h1>
          {filterDate && (
            <p className="text-xs text-muted-foreground">
              {new Date(filterDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </div>
        {restCount > 0 && (
          <button
            onClick={() => setShowRestDays(prev => !prev)}
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

      {/* Tabs */}
      <div className="flex bg-secondary/50 rounded-lg p-1 gap-1">
        <button
          onClick={() => setTab('future')}
          className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
            tab === 'future' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Upcoming ({filteredFuture.length})
        </button>
        <button
          onClick={() => setTab('history')}
          className={`flex-1 py-2 rounded-md text-sm font-semibold transition-colors ${
            tab === 'history' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          History ({filteredHistory.length})
        </button>
      </div>

      {/* Future Tab */}
      {tab === 'future' && (
        filteredFuture.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <span className="text-4xl block mb-2">🗓️</span>
            <p>No upcoming workouts scheduled.</p>
            <p className="text-xs mt-1">Create a program to schedule future workouts.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredFuture.map(fw => {
              const isRest = fw.templateId === 'rest';
              const template = !isRest ? templates.find(t => t.id === fw.templateId) : null;
              return (
                <button
                  key={fw.id}
                  onClick={() => onSelectFutureWorkout(fw)}
                  className={`w-full bg-card rounded-xl p-4 border transition-colors text-left flex items-center gap-3 ${
                    isRest ? 'border-border/50 opacity-70' : 'border-border hover:border-primary/30'
                  }`}
                >
                  <span className="text-xl">{isRest ? '😴' : '🏋️'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{fw.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(fw.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </p>
                    {template && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {template.exercises.map(e => exerciseLookup[e.exerciseId] ?? e.exerciseId).join(' → ')}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )
      )}

      {/* History Tab */}
      {tab === 'history' && (
        filteredHistory.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p>No workouts yet. Start your first session!</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredHistory.map(s => (
              <button
                key={s.id}
                onClick={() => onSelectSession(s)}
                className={`w-full bg-card rounded-xl p-4 border text-left transition-colors ${
                  s.isRestDay
                    ? 'border-border/50 opacity-80 hover:opacity-100 hover:border-primary/20'
                    : 'border-border hover:border-primary/30'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {s.isRestDay && <span className="text-base">😴</span>}
                    <span className="text-sm font-semibold text-foreground">
                      {new Date(s.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
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
                          const name = exerciseLookup[a.activityId] ?? a.activityId;
                          return name;
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
        )
      )}
    </div>
  );
};
