import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { addDays } from 'date-fns';
import { ActivityScreen } from '@/components/ActivityScreen';
import { formatLocalDate } from '@/utils/dateUtils';
import type { FutureWorkout, WorkoutSession, WorkoutTemplate } from '@/types/workout';

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [], loading: false,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

const push: WorkoutTemplate = {
  id: 'tpl-push', name: 'Push Day',
  exercises: [{ exerciseId: 'flat-barbell-bench-press', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }],
};

const day = (offset: number) => formatLocalDate(addDays(new Date(), offset));

const row = (id: string, programId: string, date: string, over: Partial<FutureWorkout> = {}): FutureWorkout =>
  ({ id, programId, date, templateId: push.id, label: id, ...over });

const session = (id: string, date: string, over: Partial<WorkoutSession> = {}): WorkoutSession =>
  ({ id, date, exercises: [], duration: 1800, totalVolume: 0, totalSets: 0, totalReps: 0, ...over });

function renderScreen(props: Partial<React.ComponentProps<typeof ActivityScreen>> = {}) {
  return render(
    <ActivityScreen
      history={[]}
      futureWorkouts={[]}
      activeProgramId="prog-active"
      templates={[push]}
      onSelectSession={vi.fn()}
      onSelectFutureWorkout={vi.fn()}
      onStartTemplate={vi.fn()}
      onBack={vi.fn()}
      {...props}
    />,
  );
}

const upcomingTabCount = () => {
  const tab = screen.getByRole('button', { name: /^Upcoming \(\d+\)$/ });
  return Number(/\((\d+)\)/.exec(tab.textContent ?? '')![1]);
};

const performedRows = () => screen.queryAllByRole('button', { name: /^Perform / });

describe("Activity's Upcoming list", () => {
  it('lists and counts only the active program and manual rows', () => {
    renderScreen({
      futureWorkouts: [
        row('retired-tomorrow', 'prog-retired', day(1)),
        row('retired-later', 'prog-retired', day(5)),
        row('active-tomorrow', 'prog-active', day(1)),
        row('manual-soon', 'manual', day(3)),
        row('active-done', 'prog-active', day(4), { completed: true }),
      ],
    });

    expect(screen.getByText('active-tomorrow')).toBeTruthy();
    expect(screen.getByText('manual-soon')).toBeTruthy();
    expect(screen.queryByText('retired-tomorrow')).toBeNull();
    expect(screen.queryByText('retired-later')).toBeNull();
    // Completed rows drop out of the undated to-do list, as they always did.
    expect(screen.queryByText('active-done')).toBeNull();

    expect(performedRows()).toHaveLength(2);
    expect(upcomingTabCount()).toBe(2);
  });

  it('shows the empty state when every upcoming row belongs to a retired program', () => {
    renderScreen({ futureWorkouts: [row('retired-tomorrow', 'prog-retired', day(1))] });

    expect(upcomingTabCount()).toBe(0);
    expect(screen.getByText('No upcoming workouts scheduled.')).toBeTruthy();
  });

  it('keeps manual rows when no program is active', () => {
    renderScreen({
      activeProgramId: null,
      futureWorkouts: [row('manual-soon', 'manual', day(2)), row('retired-tomorrow', 'prog-retired', day(1))],
    });

    expect(screen.getByText('manual-soon')).toBeTruthy();
    expect(screen.queryByText('retired-tomorrow')).toBeNull();
    expect(upcomingTabCount()).toBe(1);
  });

  it('does not offer the Rest Days toggle when the only rest days belong to a retired program', () => {
    renderScreen({
      futureWorkouts: [
        row('retired-rest', 'prog-retired', day(1), { templateId: 'rest' }),
        row('active-tomorrow', 'prog-active', day(2)),
      ],
    });

    expect(screen.queryByRole('button', { name: /Rest Days/ })).toBeNull();
  });

  it('still offers the Rest Days toggle for the active program’s rest days', () => {
    renderScreen({
      futureWorkouts: [
        row('active-rest', 'prog-active', day(1), { templateId: 'rest' }),
        row('active-tomorrow', 'prog-active', day(2)),
      ],
    });

    expect(upcomingTabCount()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: /Rest Days/ }));
    expect(screen.getByText('active-rest')).toBeTruthy();
    expect(upcomingTabCount()).toBe(2);
  });

  it('shows for a single calendar day what the calendar showed for it', () => {
    const date = day(2);
    renderScreen({
      filterDate: date,
      futureWorkouts: [
        row('retired-same-day', 'prog-retired', date),
        row('active-same-day', 'prog-active', date),
        row('active-done-same-day', 'prog-active', date, { completed: true }),
        row('active-other-day', 'prog-active', day(3)),
      ],
    });

    expect(screen.getByText('active-same-day')).toBeTruthy();
    // A dated view keeps completed rows so the workout can be repeated.
    expect(screen.getByText('active-done-same-day')).toBeTruthy();
    expect(screen.queryByText('retired-same-day')).toBeNull();
    expect(screen.queryByText('active-other-day')).toBeNull();
    expect(upcomingTabCount()).toBe(2);
  });

  it('leaves the History tab alone', () => {
    renderScreen({
      activeProgramId: null,
      history: [session('s1', day(-1)), session('s2', day(-2), { isRestDay: true })],
      futureWorkouts: [row('retired-tomorrow', 'prog-retired', day(1))],
    });

    // Logged sessions carry no program, so none of them are scoped away; a
    // history rest day is still enough to offer the toggle.
    const historyTab = screen.getByRole('button', { name: /^History \(\d+\)$/ });
    expect(historyTab.textContent).toContain('(1)');
    expect(screen.getByRole('button', { name: /Rest Days/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Rest Days/ }));
    expect(screen.getByRole('button', { name: /^History \(\d+\)$/ }).textContent).toContain('(2)');

    fireEvent.click(screen.getByRole('button', { name: /^History \(\d+\)$/ }));
    expect(screen.getByText('Rest Day')).toBeTruthy();
  });
});
