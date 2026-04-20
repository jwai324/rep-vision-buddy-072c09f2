import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface TutorialStep {
  /** DOM id of the element to spotlight. If omitted or not found, shows centered modal. */
  targetId?: string;
  title: string;
  body: string;
  /** Which screen this step belongs to, used to advance the flow when the user navigates. */
  screen?: 'dashboard' | 'startWorkout' | 'activeSession';
  /** If true, skip this step automatically when no target exists. */
  skipIfMissing?: boolean;
}

export const DASHBOARD_STEPS: TutorialStep[] = [
  {
    title: 'Welcome to RepVision 👋',
    body: 'A quick tour of your dashboard and your first workout session. Tap Next to continue, or Skip to dismiss.',
    screen: 'dashboard',
  },
  {
    targetId: 'tutorial-streak',
    title: 'Your Streak 🔥',
    body: 'Tracks consecutive days (or weeks) you\'ve trained. Configure the mode in Settings.',
    screen: 'dashboard',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-calendar',
    title: 'Weekly Calendar',
    body: 'See completed workouts (✅), rest days (😴), and what\'s scheduled. Tap any day to view details.',
    screen: 'dashboard',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-weekly-sets',
    title: 'Weekly Sets',
    body: 'Quick volume snapshot per body part for the current week. Green = balanced, red = too few/many.',
    screen: 'dashboard',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-start-btn',
    title: 'Start a Workout',
    body: 'Tap here to begin. We\'ll continue the tour on the next screen.',
    screen: 'dashboard',
  },
];

export const START_WORKOUT_STEPS: TutorialStep[] = [
  {
    targetId: 'tutorial-blank-workout',
    title: 'Pick Blank Workout',
    body: 'Tap here to start an empty session — we\'ll add exercises next.',
    screen: 'startWorkout',
    skipIfMissing: true,
  },
];

export const SESSION_STEPS: TutorialStep[] = [
  {
    title: 'You\'re in a workout 💪',
    body: 'This is your active session. Let\'s walk through the key controls.',
    screen: 'activeSession',
  },
  {
    targetId: 'tutorial-add-exercise',
    title: 'Add Exercises',
    body: 'Tap to browse the library and add an exercise to your session.',
    screen: 'activeSession',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-set-row',
    title: 'Log a Set',
    body: 'Each row is a set. Enter your weight and reps to track your work.',
    screen: 'activeSession',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-rpe',
    title: 'Rate Your Effort',
    body: 'RPE rates effort 1–10. Tap the ? in the header to see the scale.',
    screen: 'activeSession',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-complete-set',
    title: 'Complete the Set',
    body: 'Tap ✓ to log the set and start your rest timer automatically.',
    screen: 'activeSession',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-finish-btn',
    title: 'Finish Workout',
    body: 'When you\'re done, tap Finish to review and save your session. Happy lifting!',
    screen: 'activeSession',
    skipIfMissing: true,
  },
];

interface TutorialContextValue {
  active: boolean;
  steps: TutorialStep[];
  index: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  complete: () => void;
  goToScreenSteps: (screen: TutorialStep['screen']) => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

interface ProviderProps {
  children: React.ReactNode;
  onComplete?: () => void;
}

export const TutorialProvider: React.FC<ProviderProps> = ({ children, onComplete }) => {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);

  const steps = useMemo(() => [...DASHBOARD_STEPS, ...START_WORKOUT_STEPS, ...SESSION_STEPS], []);

  const start = useCallback(() => {
    setIndex(0);
    setActive(true);
  }, []);

  const finish = useCallback(() => {
    setActive(false);
    setIndex(0);
    onComplete?.();
  }, [onComplete]);

  const next = useCallback(() => {
    setIndex(i => {
      if (i >= steps.length - 1) {
        // last step → finish
        setTimeout(() => finish(), 0);
        return i;
      }
      return i + 1;
    });
  }, [steps.length, finish]);

  const prev = useCallback(() => {
    setIndex(i => Math.max(0, i - 1));
  }, []);

  const skip = useCallback(() => finish(), [finish]);
  const complete = useCallback(() => finish(), [finish]);

  const goToScreenSteps = useCallback((screen: TutorialStep['screen']) => {
    if (!active || !screen) return;
    const targetIdx = steps.findIndex(s => s.screen === screen);
    if (targetIdx >= 0 && targetIdx > index) setIndex(targetIdx);
  }, [active, index, steps]);

  return (
    <TutorialContext.Provider value={{ active, steps, index, start, next, prev, skip, complete, goToScreenSteps }}>
      {children}
    </TutorialContext.Provider>
  );
};

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be used within TutorialProvider');
  return ctx;
}
