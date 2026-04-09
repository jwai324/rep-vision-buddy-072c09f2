import React from 'react';
import type { WorkoutSession, FutureWorkout, WorkoutTemplate } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { ArrowLeft, Dumbbell, Clock, TrendingUp, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CalendarDayDetailProps {
  date: string; // ISO date string
  pastSessions: WorkoutSession[];
  futureWorkout: FutureWorkout | null;
  template: WorkoutTemplate | null;
  onViewSession: (session: WorkoutSession) => void;
  onViewFutureWorkout: (fw: FutureWorkout) => void;
  onBack: () => void;
}

export const CalendarDayDetail: React.FC<CalendarDayDetailProps> = ({
  date, pastSessions, futureWorkout, template, onViewSession, onViewFutureWorkout, onBack,
}) => {
  const dateStr = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const isToday = new Date().toISOString().split('T')[0] === date;
  const isPast = date < new Date().toISOString().split('T')[0];

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-extrabold text-foreground">{dateStr}</h1>
          {isToday && <span className="text-xs font-bold text-primary">Today</span>}
        </div>
      </div>

      {/* Past Sessions */}
      {pastSessions.length > 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Completed {pastSessions.length > 1 ? `(${pastSessions.length})` : ''}
          </p>
          {pastSessions.map(session => {
            if (session.isRestDay) {
              const activityCount = session.recoveryActivities?.length ?? 0;
              const completedCount = session.recoveryActivities?.filter(a => a.completed).length ?? 0;
              return (
                <button
                  key={session.id}
                  onClick={() => onViewSession(session)}
                  className="bg-card rounded-xl border border-border p-4 text-left hover:border-primary/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                      <span className="text-lg">😴</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground">Rest Day</p>
                      <p className="text-xs text-muted-foreground">
                        {activityCount > 0
                          ? `${completedCount}/${activityCount} activities completed`
                          : 'No activities logged'}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </div>
                  {/* Show recovery activities */}
                  {session.recoveryActivities && session.recoveryActivities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {session.recoveryActivities.map(a => {
                        const info = EXERCISES[a.activityId];
                        return (
                          <span
                            key={a.id}
                            className={`text-[10px] px-2 py-0.5 rounded-full border ${
                              a.completed
                                ? 'bg-primary/10 border-primary/20 text-primary'
                                : 'bg-secondary border-border text-muted-foreground'
                            }`}
                          >
                            {info?.icon ?? '🏋️'} {info?.name ?? a.activityId}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </button>
              );
            }

            // Regular workout session
            return (
              <button
                key={session.id}
                onClick={() => onViewSession(session)}
                className="bg-card rounded-xl border border-border p-4 text-left hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <Dumbbell className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">
                      {session.exercises.length} exercise{session.exercises.length !== 1 ? 's' : ''}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {Math.floor(session.duration / 60)}m
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="w-3 h-3" />
                        {session.totalVolume.toLocaleString()} lbs
                      </span>
                      <span>{session.totalSets} sets</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
                {/* Exercise pills */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {session.exercises.slice(0, 5).map((ex, i) => {
                    const info = EXERCISES[ex.exerciseId];
                    return (
                      <span
                        key={i}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground"
                      >
                        {info?.icon ?? '🏋️'} {info?.name ?? ex.exerciseId}
                      </span>
                    );
                  })}
                  {session.exercises.length > 5 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground">
                      +{session.exercises.length - 5} more
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Future Workout */}
      {futureWorkout && (
        <div className="flex flex-col gap-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Scheduled</p>
          <button
            onClick={() => onViewFutureWorkout(futureWorkout)}
            className="bg-card rounded-xl border border-border p-4 text-left hover:border-primary/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                {futureWorkout.templateId === 'rest' ? (
                  <span className="text-lg">😴</span>
                ) : (
                  <Dumbbell className="w-5 h-5 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{futureWorkout.label}</p>
                {template && (
                  <p className="text-xs text-muted-foreground">
                    {template.exercises.length} exercise{template.exercises.length !== 1 ? 's' : ''}
                  </p>
                )}
                {futureWorkout.templateId === 'rest' && futureWorkout.recoveryActivities && futureWorkout.recoveryActivities.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {futureWorkout.recoveryActivities.length} recovery activit{futureWorkout.recoveryActivities.length !== 1 ? 'ies' : 'y'}
                  </p>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </div>
          </button>
        </div>
      )}

      {/* Empty state */}
      {pastSessions.length === 0 && !futureWorkout && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-12">
          <span className="text-4xl">📅</span>
          <p className="text-muted-foreground text-sm">Nothing scheduled or logged for this day.</p>
        </div>
      )}
    </div>
  );
};
