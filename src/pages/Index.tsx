import React, { useState } from 'react';
import { useStorage } from '@/hooks/useStorage';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { BrowseExercisesScreen } from '@/components/BrowseExercisesScreen';
import { Dashboard } from '@/components/Dashboard';
import { ActiveSession } from '@/components/ActiveSession';
import { StartWorkoutScreen } from '@/components/StartWorkoutScreen';
import { SessionSummary } from '@/components/SessionSummary';
import { ActivityScreen } from '@/components/ActivityScreen';
import { FutureWorkoutDetail } from '@/components/FutureWorkoutDetail';
import { ErrorBoundary } from '@/components/ErrorBoundary';

import { SettingsScreen } from '@/components/SettingsScreen';
import { TemplatesScreen } from '@/components/TemplatesScreen';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import { ProgramsScreen } from '@/components/ProgramsScreen';
import { ProgramBuilder } from '@/components/ProgramBuilder';
import type { ExerciseId, WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import { format } from 'date-fns';

type Screen =
  | { type: 'dashboard' }
  | { type: 'startWorkout' }
  | { type: 'browseExercises' }
  | { type: 'activeSession'; exercises: ExerciseId[]; templateExercises?: WorkoutTemplate['exercises'] }
  | { type: 'summary'; session: WorkoutSession }
  | { type: 'sessionDetail'; session: WorkoutSession; from?: 'activity' }
  | { type: 'activity'; initialTab?: 'history' | 'future'; filterDate?: string }
  | { type: 'futureWorkoutDetail'; futureWorkout: FutureWorkout; from?: 'activity' }
  | { type: 'templates' }
  | { type: 'templateBuilder'; template?: WorkoutTemplate }
  | { type: 'programs' }
  | { type: 'programBuilder'; program?: WorkoutProgram }
  | { type: 'settings' };

const Index = () => {
  const storage = useStorage();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });

  if (storage.loading) {
    return (
      <div className="max-w-lg mx-auto min-h-screen flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-muted-foreground">Loading your data…</p>
        </div>
      </div>
    );
  }

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
        <ErrorBoundary fallbackTitle="Dashboard error" onReset={() => setScreen({ type: 'dashboard' })}>
          <Dashboard
            history={storage.history}
            activeProgram={activeProgram}
            templates={storage.templates}
            futureWorkouts={storage.futureWorkouts}
            onStartWorkout={() => setScreen({ type: 'startWorkout' })}
            onGoToFutureWorkouts={() => setScreen({ type: 'activity', initialTab: 'future' })}
            onStartTemplate={startFromTemplate}
            onGoToHistory={() => setScreen({ type: 'activity', initialTab: 'history' })}
            onGoToTemplates={() => setScreen({ type: 'templates' })}
            onGoToPrograms={() => setScreen({ type: 'programs' })}
            onBrowseExercises={() => setScreen({ type: 'browseExercises' })}
            onGoToSettings={() => setScreen({ type: 'settings' })}
            onDayClick={(date) => {
              const dateStr = format(date, 'yyyy-MM-dd');
              const isPast = dateStr < format(new Date(), 'yyyy-MM-dd');
              setScreen({ type: 'activity', initialTab: isPast ? 'history' : 'future', filterDate: dateStr });
            }}
          />
        </ErrorBoundary>
      )}

      {screen.type === 'startWorkout' && (
        <StartWorkoutScreen
          templates={storage.templates}
          activeProgram={activeProgram}
          futureWorkouts={storage.futureWorkouts}
          onBlankWorkout={() => setScreen({ type: 'activeSession', exercises: [] })}
          onSelectTemplate={startFromTemplate}
          onStartProgramDay={startFromTemplate}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'browseExercises' && (
        <BrowseExercisesScreen onBack={() => setScreen({ type: 'dashboard' })} history={storage.history} weightUnit={storage.preferences.weightUnit} />
      )}

      {screen.type === 'activeSession' && (
        <ErrorBoundary fallbackTitle="Workout session error" onReset={() => setScreen({ type: 'dashboard' })}>
          <ActiveSession
            exercises={screen.exercises}
            templateExercises={screen.templateExercises}
            history={storage.history}
            weightUnit={storage.preferences.weightUnit}
            onFinish={(session) => setScreen({ type: 'summary', session })}
            onCancel={() => setScreen({ type: 'dashboard' })}
          />
        </ErrorBoundary>
      )}

      {screen.type === 'summary' && (
        <SessionSummary
          session={screen.session}
          weightUnit={storage.preferences.weightUnit}
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

      {screen.type === 'activity' && (
        <ActivityScreen
          history={storage.history}
          futureWorkouts={storage.futureWorkouts}
          templates={storage.templates}
          onSelectSession={(session) => setScreen({ type: 'sessionDetail', session, from: 'activity' })}
          onSelectFutureWorkout={(fw) => setScreen({ type: 'futureWorkoutDetail', futureWorkout: fw, from: 'activity' })}
          onBack={() => setScreen({ type: 'dashboard' })}
          initialTab={screen.initialTab}
          filterDate={screen.filterDate}
        />
      )}

      {screen.type === 'futureWorkoutDetail' && (() => {
        const fwId = screen.futureWorkout.id;
        const fw = storage.futureWorkouts.find(f => f.id === fwId) ?? screen.futureWorkout;
        const template = storage.templates.find(t => t.id === fw.templateId) ?? null;
        return (
          <FutureWorkoutDetail
            futureWorkout={fw}
            template={template}
            onPerformWorkout={startFromTemplate}
            onUpdateFutureWorkout={storage.updateFutureWorkout}
            onSaveRestDay={(restFw) => {
              const session: WorkoutSession = {
                id: crypto.randomUUID(),
                date: restFw.date,
                exercises: [],
                duration: 0,
                totalVolume: 0,
                totalSets: 0,
                totalReps: 0,
                isRestDay: true,
                recoveryActivities: restFw.recoveryActivities,
              };
              storage.saveSession(session);
              setScreen(screen.from === 'activity'
                ? { type: 'activity', initialTab: 'future' }
                : { type: 'dashboard' });
            }}
            onBack={() => setScreen(
              screen.from === 'activity'
                ? { type: 'activity', initialTab: 'future' }
                : { type: 'dashboard' }
            )}
          />
        );
      })()}

      {screen.type === 'sessionDetail' && (
        <SessionSummary
          session={screen.session}
          weightUnit={storage.preferences.weightUnit}
          onSave={() => setScreen({ type: 'activity', initialTab: 'history' })}
          onSaveAsTemplate={() => setScreen({ type: 'activity', initialTab: 'history' })}
          onClose={() => setScreen({ type: 'activity', initialTab: 'history' })}
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
          history={storage.history}
          initial={screen.program}
          onSave={(p) => {
            storage.saveProgram(p);
            setScreen({ type: 'programs' });
          }}
          onCancel={() => setScreen({ type: 'programs' })}
        />
      )}

      {screen.type === 'settings' && (
        <SettingsScreen
          preferences={storage.preferences}
          profile={storage.profile}
          onUpdatePreferences={storage.updatePreferences}
          onUpdateProfile={storage.updateProfile}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

    </div>
  );
};

export default Index;
