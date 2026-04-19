import React, { useState, useMemo } from 'react';
import type { WorkoutTemplate, FutureWorkout } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { ArrowLeft, ChevronRight, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { formatLocalDate, parseLocalDate } from '@/utils/dateUtils';

interface FutureWorkoutsScreenProps {
  futureWorkouts: FutureWorkout[];
  templates: WorkoutTemplate[];
  onSelectFutureWorkout: (fw: FutureWorkout) => void;
  onBack: () => void;
}

export const FutureWorkoutsScreen: React.FC<FutureWorkoutsScreenProps> = ({
  futureWorkouts, templates, onSelectFutureWorkout, onBack,
}) => {
  const [showRestDays, setShowRestDays] = useState(false);
  const today = formatLocalDate(new Date());

  const visible = useMemo(
    () => showRestDays ? futureWorkouts : futureWorkouts.filter(fw => fw.templateId !== 'rest'),
    [futureWorkouts, showRestDays]
  );

  const missed = useMemo(
    () => visible.filter(fw => fw.date < today && !fw.completed).sort((a, b) => a.date.localeCompare(b.date)),
    [visible, today]
  );
  const upcoming = useMemo(
    () => visible.filter(fw => !(fw.date < today && !fw.completed)).sort((a, b) => a.date.localeCompare(b.date)),
    [visible, today]
  );

  const renderItem = (fw: FutureWorkout, isMissed: boolean) => {
    const isRest = fw.templateId === 'rest';
    const template = !isRest ? templates.find(t => t.id === fw.templateId) : null;
    return (
      <button
        key={fw.id}
        onClick={() => onSelectFutureWorkout(fw)}
        className={`w-full bg-card rounded-xl p-4 border transition-colors text-left flex items-center gap-3 ${
          isMissed
            ? 'border-destructive/40 hover:border-destructive/60'
            : isRest ? 'border-border/50 opacity-70' : 'border-border hover:border-primary/30'
        }`}
      >
        <span className="text-xl">{isRest ? '😴' : '🏋️'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground truncate">{fw.label}</p>
            {isMissed && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-destructive/15 text-destructive text-[10px] font-bold uppercase tracking-wide shrink-0">
                <AlertTriangle className="w-3 h-3" />
                Missed
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {parseLocalDate(fw.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </p>
          {template && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {template.exercises.map(e => EXERCISES[e.exerciseId]?.name).join(' → ')}
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground flex-1">Future Workouts</h1>
        <button
          onClick={() => setShowRestDays(prev => !prev)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/60 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {showRestDays ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          Rest Days
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <span className="text-4xl block mb-2">🗓️</span>
          <p>No upcoming workouts scheduled.</p>
          <p className="text-xs mt-1">Create a program to schedule future workouts.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {missed.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[10px] uppercase tracking-widest text-destructive font-bold flex items-center gap-1.5">
                <AlertTriangle className="w-3 h-3" />
                Missed ({missed.length})
              </p>
              {missed.map(fw => renderItem(fw, true))}
            </div>
          )}
          {upcoming.length > 0 && (
            <div className="flex flex-col gap-2">
              {missed.length > 0 && (
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Upcoming</p>
              )}
              {upcoming.map(fw => renderItem(fw, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
