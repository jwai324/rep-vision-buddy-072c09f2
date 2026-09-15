import React, { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { WorkoutProgram, WorkoutTemplate } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { SharedProgramView } from '@/components/shared/SharedProgramView';
import { buildProgramSnapshot, type CustomExerciseLite } from '@/utils/shareSnapshot';

interface ProgramViewProps {
  /** Resolved from the live list, so it is undefined once the program is deleted. */
  program: WorkoutProgram | undefined;
  templates: WorkoutTemplate[];
  customExercises: CustomExerciseLite[];
  weightUnit: WeightUnit;
  onBack: () => void;
}

/**
 * Read-only look at one of the user's own programs, rendered exactly as a
 * share recipient sees it. The snapshot builder is reused because it is what
 * assembles the shape `SharedProgramView` reads — resolved exercise names, the
 * referenced templates, the custom definitions — so the two renders can't
 * drift. Nothing is persisted: it is rebuilt from live data on every change,
 * which is the one way this differs from a frozen share payload.
 */
export const ProgramView: React.FC<ProgramViewProps> = ({
  program, templates, customExercises, weightUnit, onBack,
}) => {
  const view = useMemo(
    () => (program
      ? buildProgramSnapshot(program, templates, { weightUnit, sharedBy: null, customExercises })
      : null),
    [program, templates, weightUnit, customExercises],
  );

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onBack}
          aria-label="Back to programs"
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground truncate min-w-0">
          {program?.name ?? 'Program'}
        </h1>
      </div>

      {view ? (
        <SharedProgramView
          program={view.program}
          templates={view.templates}
          exerciseMeta={view.exerciseMeta}
          customExercises={view.customExercises}
          unit={weightUnit}
          hideName
        />
      ) : (
        <p className="text-sm text-muted-foreground">This program is no longer available.</p>
      )}
    </div>
  );
};
