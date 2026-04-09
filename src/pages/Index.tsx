import React, { useState } from 'react';
import { useStorage } from '@/hooks/useStorage';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { Dashboard } from '@/components/Dashboard';
import { ActiveSession } from '@/components/ActiveSession';
import { StartWorkoutScreen } from '@/components/StartWorkoutScreen';
import { SessionSummary } from '@/components/SessionSummary';
import { WorkoutHistory } from '@/components/WorkoutHistory';
import { TemplatesScreen } from '@/components/TemplatesScreen';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import { ProgramsScreen } from '@/components/ProgramsScreen';
import { ProgramBuilder } from '@/components/ProgramBuilder';
import type { ExerciseId, WorkoutSession, WorkoutTemplate, WorkoutProgram } from '@/types/workout';

type Screen =
  | { type: 'dashboard' }
  | { type: 'startWorkout' }
  | { type: 'browseExercises' }
  | { type: 'activeSession'; exercises: ExerciseId[]; templateExercises?: WorkoutTemplate['exercises'] }
  | { type: 'summary'; session: WorkoutSession }
  | { type: 'sessionDetail'; session: WorkoutSession }
  | { type: 'history' }
  | { type: 'templates' }
  | { type: 'templateBuilder'; template?: WorkoutTemplate }
  | { type: 'programs' }
  | { type: 'programBuilder'; program?: WorkoutProgram };

const Index = () => {
  const storage = useStorage();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });

  const activeProgram = storage.activeProgramId
    ? storage.programs.find(p => p.id === storage.activeProgramId) ?? null
    : null;

  const startFromTemplate = (template: WorkoutTemplate) => {
    setScreen({
      type: 'activeSession',
      exercises: template.exercises.map(e => e.exerciseId),
      templateExercises: template.exercises,
    });
  };

  return (
    <div className="max-w-lg mx-auto min-h-screen">
      {screen.type === 'dashboard' && (
        <Dashboard
          history={storage.history}
          activeProgram={activeProgram}
          templates={storage.templates}
          onStartWorkout={() => setScreen({ type: 'startWorkout' })}
          onStartTemplate={startFromTemplate}
          onGoToHistory={() => setScreen({ type: 'history' })}
          onGoToTemplates={() => setScreen({ type: 'templates' })}
          onGoToPrograms={() => setScreen({ type: 'programs' })}
        />
      )}

      {screen.type === 'startWorkout' && (
        <StartWorkoutScreen
          templates={storage.templates}
          activeProgram={activeProgram}
          onBlankWorkout={() => setScreen({ type: 'activeSession', exercises: [] })}
          onSelectTemplate={startFromTemplate}
          onStartProgramDay={startFromTemplate}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'browseExercises' && (
        <div className="min-h-screen bg-background flex flex-col">
          <div className="p-4 pb-0">
            <button onClick={() => setScreen({ type: 'startWorkout' })} className="text-sm text-muted-foreground hover:text-foreground mb-2">← Back</button>
          </div>
          <ExerciseSelector onSelect={() => {}} multiSelect={false} />
        </div>
      )}

      {screen.type === 'activeSession' && (
        <ActiveSession
          exercises={screen.exercises}
          templateExercises={screen.templateExercises}
          history={storage.history}
          onFinish={(session) => setScreen({ type: 'summary', session })}
          onCancel={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'summary' && (
        <SessionSummary
          session={screen.session}
          onSave={() => {
            storage.saveSession(screen.session);
            setScreen({ type: 'dashboard' });
          }}
          onSaveAsTemplate={() => {
            storage.saveSession(screen.session);
            // Auto-create template from session
            const template: WorkoutTemplate = {
              id: crypto.randomUUID(),
              name: `Workout ${new Date(screen.session.date).toLocaleDateString()}`,
              exercises: screen.session.exercises.map(ex => ({
                exerciseId: ex.exerciseId,
                sets: ex.sets.length,
                targetReps: ex.sets[0]?.reps ?? 10,
                setType: ex.sets[0]?.type ?? 'normal',
                restSeconds: 90,
              })),
            };
            storage.saveTemplate(template);
            setScreen({ type: 'dashboard' });
          }}
          onClose={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'history' && (
        <WorkoutHistory
          sessions={storage.history}
          onSelectSession={(session) => setScreen({ type: 'sessionDetail', session })}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'sessionDetail' && (
        <SessionSummary
          session={screen.session}
          onSave={() => setScreen({ type: 'history' })}
          onSaveAsTemplate={() => setScreen({ type: 'history' })}
          onClose={() => setScreen({ type: 'history' })}
        />
      )}

      {screen.type === 'templates' && (
        <TemplatesScreen
          templates={storage.templates}
          onStart={startFromTemplate}
          onEdit={(t) => setScreen({ type: 'templateBuilder', template: t })}
          onDelete={storage.deleteTemplate}
          onCreate={() => setScreen({ type: 'templateBuilder' })}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'templateBuilder' && (
        <TemplateBuilder
          initial={screen.template}
          onSave={(t) => {
            storage.saveTemplate(t);
            setScreen({ type: 'templates' });
          }}
          onCancel={() => setScreen({ type: 'templates' })}
        />
      )}

      {screen.type === 'programs' && (
        <ProgramsScreen
          programs={storage.programs}
          templates={storage.templates}
          activeProgramId={storage.activeProgramId}
          onSetActive={storage.setActiveProgram}
          onEdit={(p) => setScreen({ type: 'programBuilder', program: p })}
          onDelete={storage.deleteProgram}
          onCreate={() => setScreen({ type: 'programBuilder' })}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'programBuilder' && (
        <ProgramBuilder
          templates={storage.templates}
          initial={screen.program}
          onSave={(p) => {
            storage.saveProgram(p);
            setScreen({ type: 'programs' });
          }}
          onCancel={() => setScreen({ type: 'programs' })}
        />
      )}
    </div>
  );
};

export default Index;
