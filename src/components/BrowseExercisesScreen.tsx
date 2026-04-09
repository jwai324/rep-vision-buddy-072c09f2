import React, { useState } from 'react';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { ExerciseDetailModal } from '@/components/ExerciseDetailModal';
import type { ExerciseId, WorkoutSession } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';

interface BrowseExercisesScreenProps {
  onBack: () => void;
  history: WorkoutSession[];
  weightUnit?: WeightUnit;
}

export const BrowseExercisesScreen: React.FC<BrowseExercisesScreenProps> = ({ onBack, history, weightUnit = 'kg' }) => {
  const [selectedExercise, setSelectedExercise] = useState<ExerciseId | null>(null);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="p-4 pb-0">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground mb-2">← Back</button>
      </div>
      <ExerciseSelector
        onSelect={() => {}}
        multiSelect={false}
        browseMode={true}
        onExerciseTap={(id) => setSelectedExercise(id)}
      />
      <ExerciseDetailModal
        exerciseId={selectedExercise}
        onClose={() => setSelectedExercise(null)}
        history={history}
        weightUnit={weightUnit}
      />
    </div>
  );
};
