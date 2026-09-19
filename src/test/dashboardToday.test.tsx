import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Dashboard } from '@/components/Dashboard';
import type { UserPreferences } from '@/hooks/useStorage';

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [], loading: false, addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

const prefs: UserPreferences = {
  weightUnit: 'kg', defaultRestSeconds: 90, defaultDropSetsEnabled: false,
  streakMode: 'daily', streakWeeklyTarget: 3, streakAdjustment: 0, streakAdjustmentSetAt: null,
  tutorialCompleted: true, hideTimers: false, customLocations: [], stickyNotes: {},
};
const noop = () => {};

const renderDashboard = () => render(
  <Dashboard
    history={[]} activeProgram={null} templates={[]} futureWorkouts={[]} preferences={prefs}
    onStartWorkout={noop} onGoToFutureWorkouts={noop} onStartTemplate={noop} onGoToHistory={noop}
    onGoToTemplates={noop} onGoToPrograms={noop} onBrowseExercises={noop} onGoToSettings={noop}
    onGoToAnalytics={noop} onBuildAIProgram={noop} onAddRestDay={noop} onDayClick={noop}
    onGoToMonthlyCalendar={noop} onOpenTodayWorkout={noop}
  />,
);

// Both week strips (the calendar and the weekly-sets card) print the same label.
const weekLabels = (label: string) => screen.getAllByText(label);

describe('Dashboard — the week follows the clock', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('rolls both week strips over at midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 23, 59, 30)); // Sunday, 30 s to midnight
    renderDashboard();
    expect(weekLabels('Sep 14 – 20')).toHaveLength(2);

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(weekLabels('Sep 21 – 27')).toHaveLength(2);
    expect(screen.queryByText('Sep 14 – 20')).toBeNull();
  });

  it('re-reads the date when the app comes back to the foreground', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 20, 12, 0, 0));
    renderDashboard();
    expect(weekLabels('Sep 14 – 20')).toHaveLength(2);

    vi.setSystemTime(new Date(2026, 8, 22, 9, 0, 0));
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(weekLabels('Sep 21 – 27')).toHaveLength(2);
  });
});
