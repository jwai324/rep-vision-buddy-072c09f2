import React from 'react';
import type { WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import { Dumbbell, ClipboardList, Calendar, ChevronRight } from 'lucide-react';

interface StartWorkoutScreenProps {
  templates: WorkoutTemplate[];
  activeProgram: WorkoutProgram | null;
  futureWorkouts: FutureWorkout[];
  onBlankWorkout: () => void;
  onSelectTemplate: (template: WorkoutTemplate) => void;
  onStartProgramDay: (template: WorkoutTemplate) => void;
  onBack: () => void;
}

export const StartWorkoutScreen: React.FC<StartWorkoutScreenProps> = ({
  templates, activeProgram, futureWorkouts, onBlankWorkout, onSelectTemplate, onStartProgramDay, onBack,
}) => {
  const lookup = useExerciseLookup();
  const dayOfWeek = new Date().getDay();
  const todayDay = activeProgram?.days[(dayOfWeek + 6) % 7];
  const todayTemplate = todayDay && todayDay.templateId !== 'rest'
    ? templates.find(t => t.id === todayDay.templateId)
    : null;
  const isRestDay = todayDay?.templateId === 'rest';

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      <div className="flex items-center justify-between pt-2">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground">← Back</button>
        <h1 className="text-lg font-bold text-foreground">Start Workout</h1>
        <div className="w-12" />
      </div>

      {/* Blank Workout */}
      <button
        id="tutorial-blank-workout"
        onClick={onBlankWorkout}
        className="bg-card rounded-xl p-5 border border-border hover:border-primary/40 transition-colors flex items-center gap-4 text-left"
      >
        <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Dumbbell className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">Blank Workout</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Start empty and add exercises as you go</p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      </button>


      {/* Active Program */}
      {activeProgram && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2 px-1">
            <Calendar className="w-3 h-3 inline mr-1" />
            Active Program — {activeProgram.name}
          </p>
          {todayTemplate ? (
            <button
              onClick={() => onStartProgramDay(todayTemplate)}
              className="w-full bg-card rounded-xl p-4 border border-primary/30 hover:border-primary/60 transition-colors text-left glow-green"
            >
              <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Today's Workout</p>
              <h3 className="font-semibold text-foreground">{todayTemplate.name}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {todayTemplate.exercises.map(e => lookup[e.exerciseId] ?? EXERCISES[e.exerciseId]?.name ?? 'Exercise').join(' → ')}
              </p>
            </button>
          ) : isRestDay ? (
            <div className="bg-card rounded-xl p-4 border border-border text-center">
              <span className="text-2xl">🛏️</span>
              <p className="text-sm text-muted-foreground mt-1">Rest day</p>
            </div>
          ) : null}
        </div>
      )}

      {/* Future Workouts */}
      {futureWorkouts.filter(fw => fw.templateId !== 'rest').length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2 px-1">
            🗓️ Future Workouts
          </p>
          <div className="flex flex-col gap-2">
            {futureWorkouts
              .filter(fw => fw.templateId !== 'rest')
              .slice(0, 5)
              .map(fw => {
                const template = templates.find(t => t.id === fw.templateId);
                return (
                  <button
                    key={fw.id}
                    onClick={() => {
                      if (template) onSelectTemplate(template);
                    }}
                    className="w-full bg-card rounded-xl p-4 border border-border hover:border-primary/30 transition-colors text-left flex items-center gap-3"
                  >
                    <div className="flex-1">
                      <h3 className="text-sm font-semibold text-foreground">{fw.label}</h3>
                      {template && <p className="text-xs text-muted-foreground mt-0.5">{template.name}</p>}
                      <p className="text-sm font-medium text-foreground/80 mt-1">
                        {new Date(fw.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                      {template && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {template.exercises.map(e => lookup[e.exerciseId] ?? EXERCISES[e.exerciseId]?.name ?? 'Exercise').join(', ')}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Templates */}
      {templates.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2 px-1">
            <ClipboardList className="w-3 h-3 inline mr-1" />
            Templates
          </p>
          <div className="flex flex-col gap-2">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => onSelectTemplate(t)}
                className="w-full bg-card rounded-xl p-4 border border-border hover:border-primary/30 transition-colors text-left flex items-center gap-3"
              >
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-foreground">{t.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t.exercises.length} exercises · {t.exercises.map(e => lookup[e.exerciseId] ?? EXERCISES[e.exerciseId]?.name ?? 'Exercise').join(', ')}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {templates.length === 0 && !activeProgram && (
        <p className="text-sm text-muted-foreground text-center py-6">
          No templates or programs yet. Start a blank workout or create a template first.
        </p>
      )}
    </div>
  );
};
