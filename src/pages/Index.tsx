import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useStorage } from '@/hooks/useStorage';
import { BrowseExercisesScreen } from '@/components/BrowseExercisesScreen';
import { Dashboard } from '@/components/Dashboard';
import { ActiveSession, getSessionCache, clearSessionCache } from '@/components/ActiveSession';
import { MinimizedSessionBar, MINIMIZED_BAR_HEIGHT } from '@/components/MinimizedSessionBar';
import { StartWorkoutScreen } from '@/components/StartWorkoutScreen';
import { SessionSummary } from '@/components/SessionSummary';
import { ActivityScreen } from '@/components/ActivityScreen';
import { FutureWorkoutDetail } from '@/components/FutureWorkoutDetail';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AnalyticsScreen } from '@/components/AnalyticsScreen';
import { DesktopSidebar } from '@/components/DesktopSidebar';

import { SettingsScreen } from '@/components/SettingsScreen';
import { TemplatesScreen } from '@/components/TemplatesScreen';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import { ProgramsScreen } from '@/components/ProgramsScreen';
import { ProgramBuilder } from '@/components/ProgramBuilder';
import { AIProgramBuilder } from '@/components/AIProgramBuilder';
import { CustomExercisesScreen } from '@/components/CustomExercisesScreen';
import { MonthlyCalendarScreen } from '@/components/MonthlyCalendarScreen';
import { ChatProvider, useChatContext } from '@/contexts/ChatContext';
import { CustomExercisesProvider, useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { TutorialProvider, useTutorial } from '@/contexts/TutorialContext';
import { TutorialOverlay } from '@/components/TutorialOverlay';
import { AIChatBubble } from '@/components/AIChatBubble';
import { templateFromSession, useDayClickHandler } from '@/hooks/useScreenHelpers';

import type { ExerciseId, WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import { format } from 'date-fns';
import { parseLocalDate, formatLocalDate } from '@/utils/dateUtils';

type Screen =
  | { type: 'dashboard' }
  | { type: 'startWorkout' }
  | { type: 'browseExercises' }
  | { type: 'activeSession'; exercises: ExerciseId[]; templateExercises?: WorkoutTemplate['exercises']; templateName?: string; templateId?: string }
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
  | { type: 'customExercises' }
  | { type: 'monthlyCalendar' };

const IndexInner = ({ storage }: { storage: ReturnType<typeof useStorage> }) => {
  const { registerScreen } = useChatContext();
  const { exercises: customExercises, addExercise: addCustomExercise, deleteExercise: deleteCustomExercise, updateExercise: updateCustomExercise } = useCustomExercisesContext();
  const tutorial = useTutorial();
  // On a cold load with a cached in-progress workout, surface a dashboard
  // banner instead of dropping the user straight back into the session.
  const [minimizedSession, setMinimizedSession] = useState<Screen | null>(() => {
    return getSessionCache() ? { type: 'activeSession', exercises: [] } : null;
  });
  const [pendingSummary, setPendingSummary] = useState<WorkoutSession | null>(null);
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });

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

  // Auto-start tutorial for first-time users
  const autoStartedRef = React.useRef(false);
  useEffect(() => {
    if (storage.loading) return;
    if (autoStartedRef.current) return;
    if (!storage.preferences.tutorialCompleted) {
      autoStartedRef.current = true;
      // Ensure we start on dashboard
      setScreen({ type: 'dashboard' });
      tutorial.start();
    }
  }, [storage.loading, storage.preferences.tutorialCompleted, tutorial]);

  // When entering active session during tutorial, jump to session steps
  useEffect(() => {
    if (!tutorial.active) return;
    if (screen.type === 'activeSession') {
      tutorial.goToScreenSteps('activeSession');
    } else if (screen.type === 'startWorkout') {
      tutorial.goToScreenSteps('startWorkout');
    } else if (screen.type === 'dashboard') {
      tutorial.goToScreenSteps('dashboard');
    }
  }, [screen.type, tutorial]);

  // Wire tutorial Back button to navigate the page back across screen boundaries
  useEffect(() => {
    tutorial.setScreenBackHandler((targetScreen) => {
      if (targetScreen === 'dashboard') {
        if (screen.type === 'activeSession') {
          // Preserve the workout — minimize instead of discard
          setMinimizedSession(screen);
        }
        setScreen({ type: 'dashboard' });
      } else if (targetScreen === 'startWorkout') {
        if (screen.type === 'activeSession') {
          setMinimizedSession(screen);
        }
        setScreen({ type: 'startWorkout' });
      }
    });
    return () => tutorial.setScreenBackHandler(null);
  }, [tutorial, screen]);

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

  const handleDiscardMinimized = () => {
    clearSessionCache();
    setMinimizedSession(null);
    setPendingSummary(null);
  };

  const activeProgram = storage.activeProgramId
    ? storage.programs.find(p => p.id === storage.activeProgramId) ?? null
    : null;

  const handleDayClick = useDayClickHandler(
    { history: storage.history, futureWorkouts: storage.futureWorkouts, activeProgram, activeProgramId: storage.activeProgramId },
    setScreen,
  );

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

  const startFromTemplate = (template: WorkoutTemplate) => {
    setScreen({
      type: 'activeSession',
      exercises: template.exercises.map(e => e.exerciseId),
      templateExercises: template.exercises,
      templateName: template.name,
      templateId: template.id,
    });
  };

  const handleDesktopNav = (key: string) => {
    setScreen({ type: key } as Screen);
  };

  const showMinimizedBar = !!minimizedSession && screen.type !== 'activeSession';

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden">
      <DesktopSidebar activeScreen={screen.type} onNavigate={handleDesktopNav} />
      <div
        className="flex-1 max-w-3xl mx-auto min-h-screen overflow-x-hidden transition-[padding-bottom] duration-150"
        style={showMinimizedBar ? { paddingBottom: `calc(${MINIMIZED_BAR_HEIGHT}px + env(safe-area-inset-bottom))` } : undefined}
      >
      {screen.type === 'dashboard' && (
        <ErrorBoundary fallbackTitle="Dashboard error" onReset={() => setScreen({ type: 'dashboard' })}>
          <Dashboard
            history={storage.history}
            activeProgram={activeProgram}
            templates={storage.templates}
            futureWorkouts={storage.futureWorkouts}
            preferences={storage.preferences}
            hasActiveWorkout={!!minimizedSession}
            onStartWorkout={() => {
              if (minimizedSession) handleExpand();
              else setScreen({ type: 'startWorkout' });
            }}
            onGoToFutureWorkouts={() => setScreen({ type: 'activity', initialTab: 'future' })}
            onStartTemplate={startFromTemplate}
            onGoToHistory={() => setScreen({ type: 'activity', initialTab: 'history' })}
            onGoToTemplates={() => setScreen({ type: 'templates' })}
            onGoToPrograms={() => setScreen({ type: 'programs' })}
            onBrowseExercises={() => setScreen({ type: 'browseExercises' })}
            onGoToSettings={() => setScreen({ type: 'settings' })}
            onGoToAnalytics={() => setScreen({ type: 'analytics' })}
            onBuildAIProgram={() => setScreen({ type: 'aiProgramBuilder' })}
            onGoToMonthlyCalendar={() => setScreen({ type: 'monthlyCalendar' })}
            onOpenTodayWorkout={(template, dateStr) => {
              const stored = storage.futureWorkouts.find(f => f.date === dateStr && f.templateId === template.id);
              if (stored) {
                setScreen({ type: 'futureWorkoutDetail', futureWorkout: stored });
                return;
              }
              const synthetic: FutureWorkout = {
                id: `synthetic-${dateStr}`,
                programId: storage.activeProgramId ?? 'manual',
                date: dateStr,
                templateId: template.id,
                label: template.name,
              };
              setScreen({ type: 'futureWorkoutDetail', futureWorkout: synthetic });
            }}
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
            onDayClick={handleDayClick}
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
        <ErrorBoundary fallbackTitle="Workout session error" onReset={() => { clearSessionCache(); setMinimizedSession(null); setPendingSummary(null); setScreen({ type: 'dashboard' }); }}>
          <ActiveSession
            exercises={screen.exercises}
            templateExercises={screen.templateExercises}
            templateName={screen.templateName}
            templateId={screen.templateId}
            template={screen.templateId ? storage.templates.find(t => t.id === screen.templateId) ?? null : null}
            history={storage.history}
            weightUnit={storage.preferences.weightUnit}
            defaultDropSetsEnabled={storage.preferences.defaultDropSetsEnabled}
            cachedSession={getSessionCache()}
            onFinish={(session) => { setPendingSummary(session); }}
            onCancel={() => { clearSessionCache(); setMinimizedSession(null); setPendingSummary(null); setScreen({ type: 'dashboard' }); }}
            onMinimize={handleMinimize}
            onUpdateTemplate={(t) => storage.saveTemplate(t)}
            hideTimersPref={storage.preferences.hideTimers}
            onUpdateHideTimers={(val) => storage.updatePreferences({ hideTimers: val })}
            customLocations={storage.preferences.customLocations}
            onUpdateCustomLocations={(locs) => storage.updatePreferences({ customLocations: locs })}
            stickyNotes={storage.preferences.stickyNotes}
            onUpdateStickyNotes={storage.updatePreferences}
          />
        </ErrorBoundary>
      )}

      {/* Summary overlay — kept above ActiveSession so timers/cache stay alive until Save */}
      {pendingSummary && screen.type === 'activeSession' && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
          <SessionSummary
            session={pendingSummary}
            weightUnit={storage.preferences.weightUnit}
            onSave={() => {
              storage.saveSession(pendingSummary);
              clearSessionCache();
              setMinimizedSession(null);
              setPendingSummary(null);
              setScreen({ type: 'dashboard' });
            }}
            onSaveAsTemplate={() => {
              storage.saveSession(pendingSummary);
              clearSessionCache();
              storage.saveTemplate(templateFromSession(pendingSummary));
              setMinimizedSession(null);
              setPendingSummary(null);
              setScreen({ type: 'dashboard' });
            }}
            onContinue={() => setPendingSummary(null)}
            onClose={() => {
              clearSessionCache();
              setMinimizedSession(null);
              setPendingSummary(null);
              setScreen({ type: 'dashboard' });
            }}
          />
        </div>
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
            customLocations={storage.preferences.customLocations}
            onUpdateCustomLocations={(locs) => storage.updatePreferences({ customLocations: locs })}
            stickyNotes={storage.preferences.stickyNotes}
            onUpdateStickyNotes={storage.updatePreferences}
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
            storage.saveTemplate(templateFromSession(screen.session));
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
        const isSynthetic = fw.id.startsWith('synthetic-');
        const isManual = fw.programId === 'manual';
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const hasValidProgramId = uuidRe.test(fw.programId);
        const canPersist = hasValidProgramId && !isManual;

        const handleUpdate = canPersist
          ? (incoming: FutureWorkout) => {
              let next = incoming;
              if (incoming.id.startsWith('synthetic-')) {
                next = { ...incoming, id: crypto.randomUUID() };
                setScreen(prev => prev.type === 'futureWorkoutDetail'
                  ? { ...prev, futureWorkout: next }
                  : prev);
              }
              storage.updateFutureWorkout(next);
            }
          : undefined;

        return (
          <FutureWorkoutDetail
            futureWorkout={fw}
            template={template}
            onPerformWorkout={startFromTemplate}
            onUpdateFutureWorkout={handleUpdate}
            onDeleteFutureWorkout={canPersist && !isSynthetic ? storage.deleteFutureWorkout : undefined}
            onPushProgramBack={canPersist && !isSynthetic ? storage.pushProgramBack : undefined}
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
          onSaveAsTemplate={() => {
            storage.saveTemplate(templateFromSession(screen.session));
            toast.success('Template saved');
          }}
          onClose={() => setScreen({ type: 'activity', initialTab: 'history' })}
          onReperform={(session) => {
            startFromTemplate(templateFromSession(session));
          }}
          onEdit={(session) => setScreen({ type: 'editSession', session })}
          onDelete={(id) => {
            storage.deleteSession(id);
            setScreen({ type: 'activity', initialTab: 'history' });
          }}
          onUpdateSession={(updated) => {
            storage.saveSession(updated);
            setScreen({ type: 'sessionDetail', session: updated, from: 'activity' });
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
          onReplayTutorial={() => {
            setScreen({ type: 'dashboard' });
            // Defer to next tick so dashboard mounts before overlay measures
            setTimeout(() => tutorial.start(), 50);
          }}
        />
      )}

      {screen.type === 'analytics' && (
        <AnalyticsScreen
          history={storage.history}
          weightUnit={storage.preferences.weightUnit}
          preferences={storage.preferences}
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

      {screen.type === 'monthlyCalendar' && (
        <MonthlyCalendarScreen
          history={storage.history}
          templates={storage.templates}
          futureWorkouts={storage.futureWorkouts}
          activeProgram={activeProgram}
          onBack={() => setScreen({ type: 'dashboard' })}
          onStartTemplate={startFromTemplate}
          onOpenFutureWorkout={(fw) => setScreen({ type: 'futureWorkoutDetail', futureWorkout: fw })}
          onOpenSession={(session) => setScreen({ type: 'sessionDetail', session, from: 'activity' })}
          onAddRestDay={(dateStr) => {
            const restFw: FutureWorkout = {
              id: crypto.randomUUID(),
              programId: 'manual',
              date: dateStr,
              templateId: 'rest',
              label: 'Rest Day',
            };
            setScreen({ type: 'futureWorkoutDetail', futureWorkout: restFw });
          }}
        />
      )}

      {showMinimizedBar && (
        <MinimizedSessionBar
          workoutName={getSessionCache()?.workoutName ?? 'Workout'}
          startTimestamp={getSessionCache()?.startTimestamp ?? null}
          onExpand={handleExpand}
          onDiscard={handleDiscardMinimized}
        />
      )}

      <TutorialOverlay />

      <AIChatBubble templates={storage.templates} />
      </div>
    </div>
  );
};

const Index = () => {
  const storage = useStorage();
  const handleTutorialComplete = React.useCallback(() => {
    storage.updatePreferences({ tutorialCompleted: true });
  }, [storage]);
  return (
    <CustomExercisesProvider>
      <ErrorBoundary fallbackTitle="Chat unavailable — try reloading">
        <ChatProvider storage={storage}>
          <TutorialProvider onComplete={handleTutorialComplete}>
            <IndexInner storage={storage} />
          </TutorialProvider>
        </ChatProvider>
      </ErrorBoundary>
    </CustomExercisesProvider>
  );
};

export default Index;
