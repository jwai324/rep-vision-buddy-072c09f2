import React from 'react';
import type { FutureWorkout, WorkoutTemplate } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { ArrowLeft, Dumbbell } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FutureWorkoutDetailProps {
  futureWorkout: FutureWorkout;
  template: WorkoutTemplate | null;
  onPerformWorkout: (template: WorkoutTemplate) => void;
  onBack: () => void;
}

export const FutureWorkoutDetail: React.FC<FutureWorkoutDetailProps> = ({
  futureWorkout, template, onPerformWorkout, onBack,
}) => {
  const isRest = futureWorkout.templateId === 'rest';
  const dateStr = new Date(futureWorkout.date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-extrabold text-foreground">{futureWorkout.label}</h1>
          <p className="text-xs text-muted-foreground">{dateStr}</p>
        </div>
      </div>

      {isRest ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-12">
          <span className="text-5xl">🛏️</span>
          <h2 className="text-2xl font-bold text-foreground">Rest Day</h2>
          <p className="text-sm text-muted-foreground">Take it easy and recover.</p>
        </div>
      ) : template ? (
        <div className="flex flex-col gap-4 flex-1">
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">Exercises</p>
            <div className="flex flex-col gap-3">
              {template.exercises.map((ex, i) => {
                const info = EXERCISES[ex.exerciseId];
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm">{info?.icon ?? '🏋️'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{info?.name ?? ex.exerciseId}</p>
                      <p className="text-xs text-muted-foreground">
                        {ex.sets} sets × {ex.targetReps === 'failure' ? 'failure' : `${ex.targetReps} reps`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-auto pb-4">
            <Button
              variant="neon"
              size="lg"
              className="w-full text-base"
              onClick={() => onPerformWorkout(template)}
            >
              <Dumbbell className="w-5 h-5 mr-2" />
              Perform Workout
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <p>Template not found for this workout.</p>
        </div>
      )}
    </div>
  );
};
