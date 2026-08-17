import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { SharedCustomExercise, SharedExerciseMeta } from '@/types/share';
import type { WorkoutProgram, WorkoutTemplate } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { SharedTemplateView } from '@/components/shared/SharedTemplateView';

interface SharedProgramViewProps {
  program: WorkoutProgram;
  templates: WorkoutTemplate[];
  exerciseMeta: SharedExerciseMeta[];
  customExercises: SharedCustomExercise[];
  unit: WeightUnit;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function describeFrequency(day: WorkoutProgram['days'][number]): string | null {
  const f = day.frequency;
  if (!f) return null;
  if (f.type === 'weekly') return WEEKDAYS[f.weekday] ?? null;
  if (f.type === 'monthly') return `Day ${f.dayOfMonth} of each month`;
  return `Every ${f.interval} days`;
}

/**
 * Read-only render of a shared program. Templates are embedded in the
 * snapshot, so nothing is looked up from the viewer's own library.
 */
export const SharedProgramView: React.FC<SharedProgramViewProps> = ({
  program, templates, exerciseMeta, customExercises, unit,
}) => {
  const [expanded, setExpanded] = useState<number | null>(null);
  const byId = useMemo(
    () => Object.fromEntries(templates.map(t => [t.id, t])),
    [templates],
  );

  const trainingDays = program.days.filter(d => d.templateId !== 'rest').length;
  const restDays = program.days.length - trainingDays;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-xl font-extrabold text-foreground">{program.name}</h2>
        <p className="text-xs text-muted-foreground">
          {program.days.length} days — {trainingDays} training, {restDays} rest
          {program.durationWeeks ? ` · ${program.durationWeeks} weeks` : ''}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {program.days.map((day, i) => {
          const isRest = day.templateId === 'rest';
          const template = isRest ? null : byId[day.templateId];
          const open = expanded === i;
          const frequency = describeFrequency(day);

          return (
            <div key={i} className="bg-card rounded-xl border border-border overflow-hidden">
              <button
                type="button"
                disabled={!template}
                onClick={() => setExpanded(open ? null : i)}
                className="w-full p-3 flex items-center justify-between gap-2 text-left disabled:cursor-default"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    Day {i + 1}: {isRest ? 'Rest' : template?.name ?? 'Unavailable'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {day.label}
                    {frequency ? ` · ${frequency}` : ''}
                  </p>
                </div>
                {template && (
                  open
                    ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
              </button>

              {open && template && (
                <div className="px-3 pb-3 border-t border-border pt-3">
                  <SharedTemplateView
                    template={template}
                    exerciseMeta={exerciseMeta}
                    customExercises={customExercises}
                    unit={unit}
                    hideName
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
