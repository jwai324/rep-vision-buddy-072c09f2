import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
    title: 'Pick an Exercise',
    body: 'Choose any exercise from the library and tap it to add it to your workout.',
    screen: 'activeSession',
  },
  {
    targetId: 'tutorial-set-row',
    title: 'Log a Set',
    body: 'Each row is a set. Below we\'ll cover weight, reps, and effort.',
    screen: 'activeSession',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-weight-input',
    title: 'Enter Weight',
    body: 'Tap the weight cell and use the keypad to log the load you lifted.',
    screen: 'activeSession',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-reps-input',
    title: 'Enter Reps',
    body: 'Then enter how many reps you completed for the set.',
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
    body: 'When you\'re done, tap Finish to review your workout.',
    screen: 'activeSession',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-save-workout',
    title: 'Save Your Workout',
    body: 'Review your stats, then tap Save Workout to log this session.',
    screen: 'activeSession',
    skipIfMissing: true,
  },
  {
    targetId: 'tutorial-discard-workout',
    title: 'Or Discard',
    body: 'Started a workout by mistake? Tap Discard at the bottom to throw it away without saving. Happy lifting!',
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
  setScreenBackHandler: (handler: ((screen: TutorialStep['screen']) => void) | null) => void;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

interface ProviderProps {
  children: React.ReactNode;
  onComplete?: () => void;
}

export const TutorialProvider: React.FC<ProviderProps> = ({ children, onComplete }) => {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const screenBackHandlerRef = useRef<((screen: TutorialStep['screen']) => void) | null>(null);

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
    setIndex(i => {
      const target = Math.max(0, i - 1);
      if (target !== i) {
        const currentScreen = steps[i]?.screen;
        const targetScreen = steps[target]?.screen;
        if (targetScreen && targetScreen !== currentScreen) {
          screenBackHandlerRef.current?.(targetScreen);
        }
      }
      return target;
    });
  }, [steps]);

  const setScreenBackHandler = useCallback((handler: ((screen: TutorialStep['screen']) => void) | null) => {
    screenBackHandlerRef.current = handler;
  }, []);

  const skip = useCallback(() => finish(), [finish]);
  const complete = useCallback(() => finish(), [finish]);

  const goToScreenSteps = useCallback((screen: TutorialStep['screen']) => {
    if (!active || !screen) return;
    const targetIdx = steps.findIndex(s => s.screen === screen);
    if (targetIdx >= 0 && targetIdx > index) setIndex(targetIdx);
  }, [active, index, steps]);

  // Auto-advance based on exercise picker open/close
  const pickerOpenRef = useRef(false);
  useEffect(() => {
    if (!active) return;
    const check = () => {
      const open = !!document.getElementById('tutorial-exercise-picker-root');
      if (open === pickerOpenRef.current) return;
      pickerOpenRef.current = open;
      const current = steps[index];
      if (!current) return;
      if (open && current.targetId === 'tutorial-add-exercise') {
        // Picker opened — advance to "Pick an Exercise"
        setIndex(i => Math.min(steps.length - 1, i + 1));
      } else if (!open && current.screen === 'activeSession' && !current.targetId && current.title.startsWith('Pick')) {
        // Picker closed while on "Pick an Exercise" — advance to set row
        setIndex(i => Math.min(steps.length - 1, i + 1));
      } else if (current.targetId === 'tutorial-finish-btn' && document.getElementById('tutorial-save-workout')) {
        // Summary opened — advance to "Save Your Workout"
        setIndex(i => Math.min(steps.length - 1, i + 1));
      }
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [active, index, steps]);

  return (
    <TutorialContext.Provider value={{ active, steps, index, start, next, prev, skip, complete, goToScreenSteps, setScreenBackHandler }}>
      {children}
    </TutorialContext.Provider>
  );
};

export function useTutorial() {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be used within TutorialProvider');
  return ctx;
}
