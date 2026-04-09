import React from 'react';
import type { ExerciseId } from '@/types/workout';
import { EXERCISES } from '@/types/workout';

interface ExerciseSelectorProps {
  onSelect: (id: ExerciseId) => void;
  onStartTemplate?: () => void;
}

const exerciseIds: ExerciseId[] = ['squats', 'pushups', 'lunges', 'bicep-curls', 'shoulder-press'];

export const ExerciseSelector: React.FC<ExerciseSelectorProps> = ({ onSelect, onStartTemplate }) => {
  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">Choose Exercise</h2>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {exerciseIds.map(id => {
          const ex = EXERCISES[id];
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              className="bg-card rounded-xl p-5 flex flex-col items-center gap-2 border border-border hover:border-primary/50 hover:glow-green transition-all"
            >
              <span className="text-3xl">{ex.icon}</span>
              <span className="text-sm font-semibold text-foreground">{ex.name}</span>
            </button>
          );
        })}
        {onStartTemplate && (
          <button
            onClick={onStartTemplate}
            className="bg-card rounded-xl p-5 flex flex-col items-center gap-2 border border-dashed border-muted-foreground/30 hover:border-primary/50 transition-all"
          >
            <span className="text-3xl">📋</span>
            <span className="text-sm font-semibold text-muted-foreground">From Template</span>
          </button>
        )}
      </div>
    </div>
  );
};
