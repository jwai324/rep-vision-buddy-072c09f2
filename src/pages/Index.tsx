import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { useStorage } from '@/hooks/useStorage';
import { BrowseExercisesScreen } from '@/components/BrowseExercisesScreen';
import { Dashboard } from '@/components/Dashboard';
import { ActiveSession, getSessionCache, clearSessionCache } from '@/components/ActiveSession';
import { restoredSessionScreen } from '@/utils/sessionRestore';
import { useScreenHistory } from '@/hooks/useScreenHistory';
import { setRestTimerHidden } from '@/utils/restTimerScheduler';
import { MinimizedSessionBar, MINIMIZED_BAR_HEIGHT } from '@/components/MinimizedSessionBar';
import { StartWorkoutScreen } from '@/components/StartWorkoutScreen';
import { SessionSummary } from '@/components/SessionSummary';
import { ActivityScreen } from '@/components/ActivityScreen';
import { FutureWorkoutDetail } from '@/components/FutureWorkoutDetail';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AnalyticsScreen } from '@/components/AnalyticsScreen';
import { DesktopSidebar } from '@/components/DesktopSidebar';

import { SettingsScreen } from '@/components/SettingsScreen';
import { ProfileScreen } from '@/components/ProfileScreen';
import { CreditsScreen } from '@/components/CreditsScreen';
import { TemplatesScreen } from '@/components/TemplatesScreen';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import { ProgramsScreen } from '@/components/ProgramsScreen';
import { ProgramView } from '@/components/ProgramView';
import { ProgramBuilder } from '@/components/ProgramBuilder';
import { AIProgramBuilder } from '@/components/AIProgramBuilder';
import { CustomExercisesScreen } from '@/components/CustomExercisesScreen';
import { SharedLinksScreen } from '@/components/SharedLinksScreen';
import { ShareDialog, type ShareTarget } from '@/components/ShareDialog';
import { MonthlyCalendarScreen } from '@/components/MonthlyCalendarScreen';
import { ChatProvider, useChatContext } from '@/contexts/ChatContext';
import { CustomExercisesProvider, useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { TutorialProvider, useTutorial } from '@/contexts/TutorialContext';
import { TutorialOverlay } from '@/components/TutorialOverlay';
import { AIChatBubble } from '@/components/AIChatBubble';
import { ErrorReportButton } from '@/components/ErrorReportButton';
import { templateFromSession, useDayClickHandler } from '@/hooks/useScreenHelpers';
import { buildProgramSnapshot, buildSessionSnapshot, buildTemplateSnapshot } from '@/utils/shareSnapshot';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import type { ExerciseId, WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import { format } from 'date-fns';
import { parseLocalDate, formatLocalDate } from '@/utils/dateUtils';

type Screen =
  | { type: 'dashboard' }
  | { type: 'startWorkout' }
  | { type: 'browseExercises' }
  // `resumed` marks a screen that is picking an existing workout back up — a
  // cold-start restore or an expand of the minimized bar. Only those may read
  // the session cache; a screen opened to start a *new* workout must not, or
  // it mounts the previous workout's blocks, name and timer under the new
  // template's identity.
  | { type: 'activeSession'; exercises: ExerciseId[]; templateExercises?: WorkoutTemplate['exercises']; templateName?: string; templateId?: string; resumed?: boolean }
  | { type: 'editSession'; session: WorkoutSession }
  | { type: 'summary'; session: WorkoutSession }
  | { type: 'sessionDetail'; session: WorkoutSession; from?: 'activity' }
  | { type: 'activity'; initialTab?: 'history' | 'future'; filterDate?: string }
  | { type: 'futureWorkoutDetail'; futureWorkout: FutureWorkout; from?: 'activity' }
  | { type: 'templates' }
  | { type: 'templateBuilder'; template?: WorkoutTemplate }
  | { type: 'programs' }
  | { type: 'programView'; programId: string }
  | { type: 'programBuilder'; program?: WorkoutProgram }
  | { type: 'settings' }
  | { type: 'profile' }
  | { type: 'credits' }
  | { type: 'analytics' }
  | { type: 'aiProgramBuilder' }
  | { type: 'customExercises' }
  | { type: 'sharedLinks' }
  | { type: 'monthlyCalendar' };

// Clearance for the fixed AI chat FAB (bottom-6 = 24px + h-14 = 56px, plus breathing room)
// so page content is never hidden behind the bubble.
const CHAT_BUBBLE_GUTTER = 88;

const IndexInner = ({ storage }: { storage: ReturnType<typeof useStorage> }) => {
  const { registerScreen } = useChatContext();
  const { exercises: customExercises, addExercise: addCustomExercise, deleteExercise: deleteCustomExercise, updateExercise: updateCustomExercise } = useCustomExercisesContext();
  const tutorial = useTutorial();
  // On a cold load with a cached in-progress workout, surface a dashboard
  // banner instead of dropping the user straight back into the session.
  const [minimizedSession, setMinimizedSession] = useState<Screen | null>(
    () => {
      const restored = restoredSessionScreen(getSessionCache());
      return restored ? { ...restored, resumed: true } : null;
    },
  );
  // A workout the user asked to start while another is still in progress,
  // held until they say what should happen to the one already running.
  const [pendingStart, setPendingStart] = useState<Screen | null>(null);
  // The Save buttons stay enabled while the upsert is in flight, and a slow
  // connection invites a second tap. The session upsert is idempotent on its
  // id, but the template and the rest-day session are built fresh per tap, so
  // the second tap would write a duplicate row rather than retry the first.
  const savingRef = React.useRef(false);
  const guardedSave = async (run: () => Promise<void>) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await run();
    } finally {
      savingRef.current = false;
    }
  };
  // One rest-day session per date, so a retry after a failed save updates the
  // row the first attempt may have written rather than adding a second one.
  const restDaySessionIds = React.useRef<Map<string, string>>(new Map());
  const restDaySessionId = (date: string) => {
    const existing = restDaySessionIds.current.get(date);
    if (existing) return existing;
    const id = crypto.randomUUID();
    restDaySessionIds.current.set(date, id);
    return id;
  };
  const [pendingSummary, setPendingSummary] = useState<WorkoutSession | null>(null);
  const [screen, setScreen] = useScreenHistory<Screen>({ type: 'dashboard' }, {
    isRoot: s => s.type === 'dashboard',
    // Back out of a live workout minimizes it; the cache is untouched, so the
    // bar appears on the screen beneath and Resume brings it straight back.
    // Back with the summary open closes the summary instead: the user has
    // not left the workout, they have un-finished it.
    onUserBack: leaving => {
      if (leaving.type !== 'activeSession') return;
      if (pendingSummary) {
        setPendingSummary(null);
        return true;
      }
      setMinimizedSession(leaving);
    },
    // A screen coming back from history holds the object it was left with.
    // The rows have moved on: a session edited since is re-read so the editor
    // does not offer to save the pre-edit copy back, and one deleted since is
    // skipped rather than shown. A live workout restored this way must read
    // its cache (`resumed`), or a blank remount overwrites the real one.
    restore: s => {
      switch (s.type) {
        case 'activeSession': {
          const cache = getSessionCache();
          return cache && (cache.templateId ?? null) === (s.templateId ?? null) ? { ...s, resumed: true } : null;
        }
        case 'sessionDetail':
        case 'editSession': {
          const session = storage.history.find(h => h.id === s.session.id);
          return session ? { ...s, session } : null;
        }
        case 'futureWorkoutDetail': {
          const futureWorkout = storage.futureWorkouts.find(f => f.id === s.futureWorkout.id);
          return futureWorkout ? { ...s, futureWorkout } : null;
        }
        case 'templateBuilder': {
          if (!s.template) return s;
          const template = storage.templates.find(t => t.id === s.template?.id);
          return template ? { ...s, template } : null;
        }
        case 'programBuilder': {
          if (!s.program) return s;
          const program = storage.programs.find(p => p.id === s.program?.id);
          return program ? { ...s, program } : null;
        }
        case 'programView':
          return storage.programs.some(p => p.id === s.programId) ? s : null;
        default:
          return s;
      }
    },
  });

  // The rest timer's "Hide Timers" switch lives in the scheduler, which
  // outlives the session screen; it has to follow the preference from here,
  // because Settings is reachable while a session is minimized and the
  // screen's own hook is unmounted then.
  useEffect(() => {
    setRestTimerHidden(storage.preferences.hideTimers);
  }, [storage.preferences.hideTimers]);

  // #11: a template a program still schedules, or a custom exercise a template
  // still uses, cannot be deleted — the reference would dangle, today's workout
  // would vanish from the calendar, and the exercise would log under its raw id.
  const templateUsedBy = React.useCallback((id: string) => {
    // A failed programs query reads as "used by nothing"; until every slice
    // that could reference the template is trusted, the answer is "unknown".
    if (!storage.dataTrusted) return ['data that is still loading'];
    const programs = storage.programs.filter(p => p.days.some(d => d.templateId === id));
    const names = programs.map(p => p.name);
    const today = formatLocalDate();
    // Upcoming rows the listed programs do not account for: manual ones, and
    // rows of a program whose days no longer name this template.
    const listed = new Set(programs.map(p => p.id));
    const scheduled = storage.futureWorkouts.filter(fw =>
      fw.templateId === id && !fw.completed && fw.date >= today && !listed.has(fw.programId)).length;
    if (scheduled > 0) names.push(`${scheduled} scheduled workout${scheduled === 1 ? '' : 's'}`);
    return names;
  }, [storage.programs, storage.futureWorkouts, storage.dataTrusted]);
  const exerciseUsedBy = React.useCallback(
    (exerciseId: string) => storage.dataTrusted
      ? storage.templates.filter(t => t.exercises.some(e => e.exerciseId === exerciseId)).map(t => t.name)
      : ['data that is still loading'],
    [storage.templates, storage.dataTrusted],
  );
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);

  // Screens swap inside one window-scrolled container, so a screen opened
  // from the bottom of the dashboard — Start Workout lives there — inherited
  // the dashboard's scroll offset and painted from the middle of the page.
  // Reset before paint on every screen change. Keyed on the type, not the
  // screen object, so an in-place update of the current screen's payload
  // (a future workout being edited) does not yank the page to the top.
  React.useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [screen.type]);

  // Everything a snapshot needs beyond the item itself. Built here because
  // this is the one place that has preferences, profile, and custom exercises
  // in hand at the same time.
  const snapshotContext = React.useMemo(() => ({
    weightUnit: storage.preferences.weightUnit,
    sharedBy: storage.profile.displayName,
    customExercises,
  }), [storage.preferences.weightUnit, storage.profile.displayName, customExercises]);

  // Register screen context with AI chat
  useEffect(() => {
    const screenMap: Record<string, string> = {
      dashboard: 'dashboard', startWorkout: 'dashboard', browseExercises: 'exercises',
      // An edit is a past record, not a workout in progress: the coach has no
      // session to act on and must not be told it is mid-workout.
      activeSession: 'active_workout', editSession: 'activity',
      summary: 'dashboard', sessionDetail: 'activity', activity: 'activity',
      futureWorkoutDetail: 'activity', templates: 'templates', templateBuilder: 'templates',
      programs: 'programs', programView: 'programs', programBuilder: 'programs', settings: 'settings',
      profile: 'profile', sharedLinks: 'settings',
      analytics: 'analytics', aiProgramBuilder: 'programs',
    };
    registerScreen({ screen: screenMap[screen.type] || 'dashboard' });
  }, [screen.type, registerScreen]);

  // Auto-start tutorial for first-time users.
  //
  // Gated on dataTrusted, not on loading: a load that failed also ends loading,
  // and it leaves tutorialCompleted at its DEFAULT_PREFERENCES false. Starting
  // the tutorial there runs it over an account with months of history, and
  // finishing it writes a whole settings row built from those placeholders.
  const autoStartedRef = React.useRef(false);
  useEffect(() => {
    if (!storage.dataTrusted) return;
    if (autoStartedRef.current) return;
    if (!storage.preferences.tutorialCompleted) {
      autoStartedRef.current = true;
      // Ensure we start on dashboard
      setScreen({ type: 'dashboard' });
      tutorial.start();
    }
  }, [storage.dataTrusted, storage.preferences.tutorialCompleted, tutorial]);

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

  // The workout currently in progress, as a screen that may read the cache.
  // Keyed on the cache rather than on `minimizedSession` alone so a path that
  // navigates away from a session without minimizing it is still caught.
  const inProgressScreen = (): Screen | null => {
    if (minimizedSession?.type === 'activeSession') return { ...minimizedSession, resumed: true };
    const restored = restoredSessionScreen(getSessionCache());
    return restored ? { ...restored, resumed: true } : null;
  };

  const handleExpand = () => {
    const resume = inProgressScreen();
    if (!resume) return;
    setScreen(resume);
    setMinimizedSession(null);
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

  // Every entry point into a *new* workout goes through here. Starting one on
  // top of a workout already in progress used to mount the old one's cache
  // under the new template, which then offered to overwrite the new template
  // with the old workout's exercises and marked the wrong scheduled entry done.
  const openSession = (next: Screen) => {
    if (inProgressScreen()) {
      setPendingStart(next);
      return;
    }
    setScreen(next);
  };

  const startFromTemplate = (template: WorkoutTemplate) => {
    openSession({
      type: 'activeSession',
      exercises: template.exercises.map(e => e.exerciseId),
      templateExercises: template.exercises,
      templateName: template.name,
      templateId: template.id,
    });
  };

  const handleDesktopNav = (key: string) => {
    // Sidebar navigation used to leave a running session with no minimized bar
    // and no way back short of a reload.
    if (screen.type === 'activeSession') setMinimizedSession(screen);
    setScreen({ type: key } as Screen);
  };

  const showMinimizedBar = !!minimizedSession && screen.type !== 'activeSession';

  return (
    <div className="flex min-h-screen w-full overflow-x-hidden">
      <DesktopSidebar activeScreen={screen.type} onNavigate={handleDesktopNav} />
      <div
        className="flex-1 max-w-3xl mx-auto min-h-screen overflow-x-hidden transition-[padding-bottom] duration-150"
        style={{
          paddingBottom: `calc(${
            showMinimizedBar ? Math.max(MINIMIZED_BAR_HEIGHT, CHAT_BUBBLE_GUTTER) : CHAT_BUBBLE_GUTTER
          }px + env(safe-area-inset-bottom))`,
        }}
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
              const stored = storage.futureWorkouts.find(f =>
                f.date === dateStr &&
                f.templateId === template.id &&
                (f.programId === storage.activeProgramId || f.programId === 'manual'),
              );
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
          onBlankWorkout={() => openSession({ type: 'activeSession', exercises: [] })}
          onSelectTemplate={startFromTemplate}
          onStartProgramDay={startFromTemplate}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'browseExercises' && (
        <BrowseExercisesScreen
          onBack={() => setScreen({ type: 'dashboard' })}
          history={storage.history}
          weightUnit={storage.preferences.weightUnit}
          stickyNotes={storage.preferences.stickyNotes}
          onUpdateStickyNotes={storage.updatePreferences}
        />
      )}

      {screen.type === 'activeSession' && (
        <ErrorBoundary
          fallbackTitle="Workout session error"
          // The boundary unmounted the session when it threw; remounting with
          // `resumed` rebuilds it from the cache instead of from nothing. This
          // used to clear the cache — the recovery button was the destructive one.
          onReset={() => setScreen(s => s.type === 'activeSession' ? { ...s, resumed: true } : s)}
          destructiveAction={{
            label: 'Discard workout',
            confirmLabel: 'Tap again to discard this workout',
            onClick: () => { clearSessionCache(); setMinimizedSession(null); setPendingSummary(null); setScreen({ type: 'dashboard' }); },
          }}
        >
          <ActiveSession
            exercises={screen.exercises}
            templateExercises={screen.templateExercises}
            templateName={screen.templateName}
            templateId={screen.templateId}
            template={screen.templateId ? storage.templates.find(t => t.id === screen.templateId) ?? null : null}
            history={storage.history}
            weightUnit={storage.preferences.weightUnit}
            defaultDropSetsEnabled={storage.preferences.defaultDropSetsEnabled}
            defaultRestSeconds={storage.preferences.defaultRestSeconds}
            cachedSession={screen.resumed ? getSessionCache() : null}
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
            // The session cache is the only other copy of this workout, and the
            // summary is the only screen offering a retry, so neither may be
            // torn down until the upsert has actually landed.
            onSave={() => guardedSave(async () => {
              const saved = await storage.saveSession(pendingSummary, { templateId: screen.templateId });
              if (!saved) return;
              clearSessionCache();
              setMinimizedSession(null);
              setPendingSummary(null);
              setScreen({ type: 'dashboard' });
            })}
            onSaveAsTemplate={() => guardedSave(async () => {
              const saved = await storage.saveSession(pendingSummary, { templateId: screen.templateId });
              if (!saved) return;
              clearSessionCache();
              storage.saveTemplate(templateFromSession(pendingSummary, undefined, storage.preferences.defaultRestSeconds));
              setMinimizedSession(null);
              setPendingSummary(null);
              setScreen({ type: 'dashboard' });
            })}
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
            defaultRestSeconds={storage.preferences.defaultRestSeconds}
            editSession={screen.session}
            onFinish={(session) => guardedSave(async () => {
              // Staying on the edit screen is what lets the user retry; leaving
              // discards their edits with nothing holding them. Correcting a
              // record is not doing a workout, so it never ticks off a
              // scheduled one on that date.
              const saved = await storage.saveSession(session, { markScheduled: false });
              if (!saved) return;
              setScreen({ type: 'activity', initialTab: 'history' });
            })}
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
          onSave={() => guardedSave(async () => {
            const saved = await storage.saveSession(screen.session);
            if (!saved) return;
            clearSessionCache();
            setScreen({ type: 'dashboard' });
          })}
          onSaveAsTemplate={() => guardedSave(async () => {
            const saved = await storage.saveSession(screen.session);
            if (!saved) return;
            clearSessionCache();
            storage.saveTemplate(templateFromSession(screen.session, undefined, storage.preferences.defaultRestSeconds));
            setScreen({ type: 'dashboard' });
          })}
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
          onStartTemplate={startFromTemplate}
          onBack={() => setScreen({ type: 'dashboard' })}
          initialTab={screen.initialTab}
          filterDate={screen.filterDate}
          weightUnit={storage.preferences.weightUnit}
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
          ? async (incoming: FutureWorkout) => {
              let next = incoming;
              if (incoming.id.startsWith('synthetic-')) {
                // Minted before the write so a rest day's activity taps all
                // share one id; put the synthetic row back if the write does
                // not land, or the screen shows a reschedule that never saved.
                next = { ...incoming, id: crypto.randomUUID() };
                setScreen(prev => prev.type === 'futureWorkoutDetail'
                  ? { ...prev, futureWorkout: next }
                  : prev);
              }
              // The detail screen waits for this before it says "done".
              const ok = await storage.updateFutureWorkout(next);
              if (!ok && next !== incoming) {
                setScreen(prev => prev.type === 'futureWorkoutDetail' ? { ...prev, futureWorkout: fw } : prev);
              }
              return ok;
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
            onSaveRestDay={(restFw) => guardedSave(async () => {
              const session: WorkoutSession = {
                id: restDaySessionId(restFw.date),
                date: restFw.date,
                exercises: [],
                duration: 0,
                totalVolume: 0,
                totalSets: 0,
                totalReps: 0,
                isRestDay: true,
                recoveryActivities: restFw.recoveryActivities,
              };
              const saved = await storage.saveSession(session);
              if (!saved) return;
              setScreen(screen.from === 'activity'
                ? { type: 'activity', initialTab: 'future' }
                : { type: 'dashboard' });
            })}
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
            storage.saveTemplate(templateFromSession(screen.session, undefined, storage.preferences.defaultRestSeconds));
            toast.success('Template saved');
          }}
          onClose={() => setScreen({ type: 'activity', initialTab: 'history' })}
          onReperform={(session) => {
            startFromTemplate(templateFromSession(session, undefined, storage.preferences.defaultRestSeconds));
          }}
          onEdit={(session) => setScreen({ type: 'editSession', session })}
          onDelete={(id) => {
            storage.deleteSession(id);
            setScreen({ type: 'activity', initialTab: 'history' });
          }}
          onUpdateSession={async (updated) => {
            const saved = await storage.saveSession(updated);
            if (!saved) return;
            setScreen({ type: 'sessionDetail', session: updated, from: 'activity' });
          }}
          onShare={(session) => setShareTarget({
            kind: 'session',
            sourceId: session.id,
            title: `Workout on ${parseLocalDate(session.date).toLocaleDateString()}`,
            buildPayload: () => buildSessionSnapshot(session, snapshotContext),
          })}
        />
      )}

      {screen.type === 'templates' && (
        <TemplatesScreen
          templates={storage.templates}
          onStart={startFromTemplate}
          onEdit={(t) => setScreen({ type: 'templateBuilder', template: t })}
          onDelete={storage.deleteTemplate}
          usedBy={templateUsedBy}
          onDuplicate={(t) => {
            const copy = { ...t, id: crypto.randomUUID(), name: `${t.name} (2)` };
            storage.saveTemplate(copy);
          }}
          onShare={(t) => setShareTarget({
            kind: 'template',
            sourceId: t.id,
            title: t.name,
            buildPayload: () => buildTemplateSnapshot(t, snapshotContext),
          })}
          onCreate={() => setScreen({ type: 'templateBuilder' })}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'templateBuilder' && (
        <TemplateBuilder
          initial={screen.template}
          weightUnit={storage.preferences.weightUnit}
          defaultRestSeconds={storage.preferences.defaultRestSeconds}
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
          onView={(p) => setScreen({ type: 'programView', programId: p.id })}
          onEdit={(p) => setScreen({ type: 'programBuilder', program: p })}
          onDelete={storage.deleteProgram}
          onShare={(p) => setShareTarget({
            kind: 'program',
            sourceId: p.id,
            title: p.name,
            buildPayload: () => buildProgramSnapshot(p, storage.templates, snapshotContext),
          })}
          onCreate={() => setScreen({ type: 'programBuilder' })}
          onBack={() => setScreen({ type: 'dashboard' })}
        />
      )}

      {screen.type === 'programView' && (
        <ProgramView
          program={storage.programs.find(p => p.id === screen.programId)}
          templates={storage.templates}
          customExercises={customExercises}
          weightUnit={storage.preferences.weightUnit}
          onBack={() => setScreen({ type: 'programs' })}
        />
      )}

      {screen.type === 'programBuilder' && (
        <ProgramBuilder
          templates={storage.templates}
          history={storage.history}
          initial={screen.program}
          weightUnit={storage.preferences.weightUnit}
          defaultRestSeconds={storage.preferences.defaultRestSeconds}
          onSave={async (p) => {
            const saved = await storage.saveProgram(p);
            if (saved) setScreen({ type: 'programs' });
            return saved;
          }}
          onSaveTemplate={storage.saveTemplate}
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
          onGoToProfile={() => setScreen({ type: 'profile' })}
          onGoToCredits={() => setScreen({ type: 'credits' })}
          onGoToSharedLinks={() => setScreen({ type: 'sharedLinks' })}
          onReplayTutorial={() => {
            setScreen({ type: 'dashboard' });
            // Defer to next tick so dashboard mounts before overlay measures
            setTimeout(() => tutorial.start(), 50);
          }}
        />
      )}

      {screen.type === 'profile' && (
        <ProfileScreen
          profile={storage.profile}
          bodyMeasurements={storage.bodyMeasurements}
          weightUnit={storage.preferences.weightUnit}
          onUpdateProfile={storage.updateProfile}
          onAddBodyMeasurement={storage.addBodyMeasurement}
          onDeleteBodyMeasurement={storage.deleteBodyMeasurement}
          onBack={() => setScreen({ type: 'settings' })}
        />
      )}

      {screen.type === 'credits' && (
        <CreditsScreen
          profile={storage.profile}
          onUpdateProfile={storage.updateProfile}
          onBack={() => setScreen({ type: 'settings' })}
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
            // A failed template save is queued and replayed by useStorage, so
            // it does not block the program; a failed program save does.
            for (const t of templates) {
              await storage.saveTemplate(t);
            }
            const saved = await storage.saveProgram(program);
            if (!saved) return false;
            await storage.setActiveProgram(program.id);
            setScreen({ type: 'programs' });
            return true;
          }}
        />
      )}

      {screen.type === 'customExercises' && (
        <CustomExercisesScreen
          exercises={customExercises}
          onAdd={addCustomExercise}
          onUpdate={updateCustomExercise}
          onDelete={deleteCustomExercise}
          usedBy={exerciseUsedBy}
          onBack={() => setScreen({ type: 'settings' })}
          history={storage.history}
          weightUnit={storage.preferences.weightUnit}
          stickyNotes={storage.preferences.stickyNotes}
          onUpdateStickyNotes={storage.updatePreferences}
        />
      )}

      {screen.type === 'sharedLinks' && (
        <SharedLinksScreen onBack={() => setScreen({ type: 'settings' })} />
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

      {showMinimizedBar && (() => {
        // Read cache once so timerPaused / pausedElapsedSec stay consistent
        // with the workoutName/startTimestamp we display alongside.
        const cache = getSessionCache();
        return (
          <MinimizedSessionBar
            workoutName={cache?.workoutName ?? 'Workout'}
            startTimestamp={cache?.startTimestamp ?? null}
            timerPaused={cache?.timerPaused}
            pausedElapsedSec={cache?.pausedElapsedSec ?? null}
            onExpand={handleExpand}
            onDiscard={handleDiscardMinimized}
          />
        );
      })()}

      <AlertDialog open={!!pendingStart} onOpenChange={(open) => { if (!open) setPendingStart(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You already have a workout in progress</AlertDialogTitle>
            <AlertDialogDescription>
              Starting a new one discards the sets you've already logged. Resume the
              workout in progress instead?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => { setPendingStart(null); handleExpand(); }}
            >
              Resume it
            </Button>
            <AlertDialogAction
              onClick={() => {
                const next = pendingStart;
                clearSessionCache();
                setMinimizedSession(null);
                setPendingSummary(null);
                setPendingStart(null);
                if (next) setScreen(next);
              }}
            >
              Discard &amp; start new
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShareDialog target={shareTarget} onClose={() => setShareTarget(null)} />

      <TutorialOverlay />

      <AIChatBubble
        templates={storage.templates}
        onOpenCredits={() => {
          if (screen.type === 'activeSession') setMinimizedSession(screen);
          setScreen({ type: 'credits' });
        }}
      />

      <ErrorReportButton screen={screen.type} />
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
      {/* Wraps everything below the auth provider, so a crash anywhere in the
          app lands here; the title used to blame the chat, and the bug-report
          handle it unmounted is the one thing the user needs on this screen. */}
      <ErrorBoundary fallbackTitle="Something went wrong" fallbackExtra={<ErrorReportButton screen="crash" />}>
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
