import React from 'react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { EXERCISES } from '@/types/workout';
import type { WorkoutTemplate } from '@/types/workout';
import { ArrowLeft } from 'lucide-react';

interface DayDetailProps {
  date: Date;
  template: WorkoutTemplate | null; // null = rest day
  onStartWorkout: (template: WorkoutTemplate) => void;
  onBack: () => void;
}

export const DayDetail: React.FC<DayDetailProps> = ({ date, template, onStartWorkout, onBack }) => {
  const isRest = !template;
  const dayLabel = format(date, 'EEEE, MMMM d');

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 pt-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-extrabold text-foreground">{dayLabel}</h1>
          <p className="text-xs text-muted-foreground">{isRest ? 'Rest Day' : template.name}</p>
        </div>
      </div>

      {isRest ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <span className="text-6xl">😴</span>
          <h2 className="text-2xl font-bold text-foreground">Rest Day</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            Take it easy today. Recovery is when your muscles grow stronger.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4 flex-1">
          {/* Exercise list */}
          <div className="flex flex-col gap-2">
            {template.exercises.map((ex, i) => {
              const exercise = EXERCISES[ex.exerciseId];
              return (
                <div
                  key={i}
                  className="bg-card rounded-xl p-4 border border-border flex items-center gap-3"
                >
                  <span className="text-2xl">{exercise?.icon ?? '🏋️'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">
                      {exercise?.name ?? ex.exerciseId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ex.sets} sets × {ex.targetReps === 'failure' ? 'failure' : `${ex.targetReps} reps`}
                      {ex.restSeconds ? ` · ${ex.restSeconds}s rest` : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Start button */}
          <div className="mt-auto pt-4">
            <Button
              variant="neon"
              size="lg"
              className="w-full text-lg font-bold"
              onClick={() => onStartWorkout(template)}
            >
              🎯 Start This Workout
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
