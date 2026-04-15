import React, { useState, useEffect } from 'react';
import { useStorage } from '@/hooks/useStorage';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { BrowseExercisesScreen } from '@/components/BrowseExercisesScreen';
import { Dashboard } from '@/components/Dashboard';
import { ActiveSession, getSessionCache, clearSessionCache } from '@/components/ActiveSession';
import { MinimizedSessionBar } from '@/components/MinimizedSessionBar';
import { StartWorkoutScreen } from '@/components/StartWorkoutScreen';
import { SessionSummary } from '@/components/SessionSummary';
import { ActivityScreen } from '@/components/ActivityScreen';
import { FutureWorkoutDetail } from '@/components/FutureWorkoutDetail';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AnalyticsScreen } from '@/components/AnalyticsScreen';

import { SettingsScreen } from '@/components/SettingsScreen';
import { TemplatesScreen } from '@/components/TemplatesScreen';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import { ProgramsScreen } from '@/components/ProgramsScreen';
import { ProgramBuilder } from '@/components/ProgramBuilder';
import { AIProgramBuilder } from '@/components/AIProgramBuilder';
import { CustomExercisesScreen } from '@/components/CustomExercisesScreen';
import { ChatProvider, useChatContext } from '@/contexts/ChatContext';
import { CustomExercisesProvider, useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { AIChatBubble } from '@/components/AIChatBubble';

import type { ExerciseId, WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import { format } from 'date-fns';

type Screen =
  | { type: 'dashboard' }
  | { type: 'startWorkout' }
  | { type: 'browseExercises' }
  | { type: 'activeSession'; exercises: ExerciseId[]; templateExercises?: WorkoutTemplate['exercises'] }
  | { type: 'editSession'; session: WorkoutSession }
  | { type: 'summary'; session: WorkoutSession }
  | { type: 'sessionDetail'; session: WorkoutSession; from?: 'activity' }
  | { type: 'activity'; initialTab?: 'history' | 'future'; filterDate?: string }
  | { type: 'futureWorkoutDetail'; futureWorkout: FutureWorkout; from?: 'activity' }
  | { type: 'templates' }
  | { type: 'templateBuilder'; template?: WorkoutTemplate }
  | { type: 'programs' }
  | { type: 'programBuilder'; program?: WorkoutProgram }
  | { type: 'settings' }
  | { type: 'analytics' }
  | { type: 'aiProgramBuilder' }
  | { type: 'customExercises' };

const IndexInner = ({ storage }: { storage: ReturnType<typeof useStorage> }) => {
  const { registerScreen } = useChatContext();
  const { exercises: customExercises, addExercise: addCustomExercise, deleteExercise: deleteCustomExercise, updateExercise: updateCustomExercise } = useCustomExercisesContext();
  const [minimizedSession, setMinimizedSession] = useState<Screen | null>(null);
  const [screen, setScreen] = useState<Screen>(() => {
    const cached = getSessionCache();
    if (cached) return { type: 'activeSession', exercises: [] };
    return { type: 'dashboard' };
  });

  // Register screen context with AI chat
  useEffect(() => {
    const screenMap: Record<string, string> = {
      dashboard: 'dashboard', startWorkout: 'dashboard', browseExercises: 'exercises',
      activeSession: 'active_workout', editSession: 'active_workout',
      summary: 'dashboard', sessionDetail: 'activity', activity: 'activity',
      futureWorkoutDetail: 'activity', templates: 'templates', templateBuilder: 'templates',
      programs: 'programs', programBuilder: 'programs', settings: 'settings',
      analytics: 'analytics', aiProgramBuilder: 'programs',
    };
    registerScreen({ screen: screenMap[screen.type] || 'dashboard' });
  }, [screen.type, registerScreen]);

  const handleMinimize = () => {
    setMinimizedSession(screen);
    setScreen({ type: 'dashboard' });
  };

  const handleExpand = () => {
    if (minimizedSession) {
      setScreen(minimizedSession);
      setMinimizedSession(null);
    }
  };

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
            onGoToAnalytics={() => setScreen({ type: 'analytics' })}
            onBuildAIProgram={() => setScreen({ type: 'aiProgramBuilder' })}
            onAddRestDay={() => {
              const today = format(new Date(), 'yyyy-MM-dd');
              const restFw: FutureWorkout = {
                id: crypto.randomUUID(),
                programId: 'manual',
                date: today,
                templateId: 'rest',
                label: 'Rest Day',
              };
              setScreen({ type: 'futureWorkoutDetail', futureWorkout: restFw });
            }}
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
        <ErrorBoundary fallbackTitle="Workout session error" onReset={() => { clearSessionCache(); setMinimizedSession(null); setScreen({ type: 'dashboard' }); }}>
          <ActiveSession
            exercises={screen.exercises}
            templateExercises={screen.templateExercises}
            history={storage.history}
            weightUnit={storage.preferences.weightUnit}
            defaultDropSetsEnabled={storage.preferences.defaultDropSetsEnabled}
            cachedSession={getSessionCache()}
            onFinish={(session) => { setMinimizedSession(null); setScreen({ type: 'summary', session }); }}
            onCancel={() => { clearSessionCache(); setMinimizedSession(null); setScreen({ type: 'dashboard' }); }}
            onMinimize={handleMinimize}
          />
        </ErrorBoundary>
      )}

      {screen.type === 'editSession' && (
        <ErrorBoundary fallbackTitle="Edit session error" onReset={() => setScreen({ type: 'activity', initialTab: 'history' })}>
          <ActiveSession
            exercises={[]}
            history={storage.history}
            weightUnit={storage.preferences.weightUnit}
            defaultDropSetsEnabled={storage.preferences.defaultDropSetsEnabled}
            editSession={screen.session}
            onFinish={(session) => {
              storage.saveSession(session);
              setScreen({ type: 'activity', initialTab: 'history' });
            }}
            onCancel={() => setScreen({ type: 'sessionDetail', session: screen.session, from: 'activity' })}
          />
        </ErrorBoundary>
      )}
      {screen.type === 'summary' && (
        <SessionSummary
          session={screen.session}
          weightUnit={storage.preferences.weightUnit}
          onSave={() => {
            storage.saveSession(screen.session);
            clearSessionCache();
            setScreen({ type: 'dashboard' });
          }}
          onSaveAsTemplate={() => {
            storage.saveSession(screen.session);
            clearSessionCache();
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
          onClose={() => { clearSessionCache(); setScreen({ type: 'dashboard' }); }}
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
            onUpdateFutureWorkout={fw.programId !== 'manual' ? storage.updateFutureWorkout : undefined}
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
          isViewMode
          onSave={() => setScreen({ type: 'activity', initialTab: 'history' })}
          onSaveAsTemplate={() => setScreen({ type: 'activity', initialTab: 'history' })}
          onClose={() => setScreen({ type: 'activity', initialTab: 'history' })}
          onEdit={(session) => setScreen({ type: 'editSession', session })}
          onDelete={(id) => {
            storage.deleteSession(id);
            setScreen({ type: 'activity', initialTab: 'history' });
          }}
        />
      )}

      {screen.type === 'templates' && (
        <TemplatesScreen
          templates={storage.templates}
          onStart={startFromTemplate}
          onEdit={(t) => setScreen({ type: 'templateBuilder', template: t })}
          onDelete={storage.deleteTemplate}
          onDuplicate={(t) => {
            const copy = { ...t, id: crypto.randomUUID(), name: `${t.name} (2)` };
            storage.saveTemplate(copy);
          }}
          onCreate={() => setScreen({ type: 'templateBuilder' })}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'templateBuilder' && (
        <TemplateBuilder
          initial={screen.template}
          weightUnit={storage.preferences.weightUnit}
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
          onGoToCustomExercises={() => setScreen({ type: 'customExercises' })}
        />
      )}

      {screen.type === 'analytics' && (
        <AnalyticsScreen
          history={storage.history}
          weightUnit={storage.preferences.weightUnit}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'aiProgramBuilder' && (
        <AIProgramBuilder
          onBack={() => setScreen({ type: 'dashboard' })}
          onSaveProgram={async (program, templates) => {
            for (const t of templates) {
              await storage.saveTemplate(t);
            }
            await storage.saveProgram(program);
            await storage.setActiveProgram(program.id);
            setScreen({ type: 'programs' });
          }}
        />
      )}

      {screen.type === 'customExercises' && (
        <CustomExercisesScreen
          exercises={customExercises}
          onAdd={addCustomExercise}
          onUpdate={updateCustomExercise}
          onDelete={deleteCustomExercise}
          onBack={() => setScreen({ type: 'settings' })}
        />
      )}

      {minimizedSession && screen.type !== 'activeSession' && (
        <MinimizedSessionBar
          workoutName={getSessionCache()?.workoutName ?? 'Workout'}
          onExpand={handleExpand}
        />
      )}

      {/* <AIChatBubble /> — disabled for rework */}
    </div>
  );
};

const Index = () => {
  const storage = useStorage();
  return (
    <CustomExercisesProvider>
      <ChatProvider storage={storage}>
        <IndexInner storage={storage} />
      </ChatProvider>
    </CustomExercisesProvider>
  );
};

export default Index;
