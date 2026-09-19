import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { ActiveSession } from '@/components/ActiveSession';
import { ensureRestSchedule } from '@/utils/restTimerScheduler';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));
vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [], loading: false,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));
vi.mock('@/utils/restTimerScheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/restTimerScheduler')>();
  return { ...actual, ensureRestSchedule: vi.fn() };
});

const BENCH = 'flat-barbell-bench-press';

describe('the rest that follows a stopwatch set', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it("uses the exercise's own rest, not the 90 s fallback, when React defers the block update", () => {
    render(
      <ActiveSession
        exercises={[BENCH]}
        templateExercises={[{ exerciseId: BENCH, sets: 2, targetReps: 10, setType: 'normal', restSeconds: 120 }]}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('Start next set'));
    // The countdown re-arms its timeout from an effect, so it is walked one
    // second at a time.
    for (let i = 0; i < 6; i++) act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Stop set')).toBeInTheDocument();

    // A state update already queued on the screen when Stop is tapped means
    // React runs the blocks updater during the next render rather than
    // eagerly inside the tap — the case that used to start a 90 s rest.
    act(() => {
      fireEvent.change(screen.getByDisplayValue('Workout'), { target: { value: 'Push' } });
      fireEvent.click(screen.getByText('Stop set'));
    });

    const durations = vi.mocked(ensureRestSchedule).mock.calls.map(c => c[0].durationMs);
    expect(durations.length).toBeGreaterThan(0);
    expect(new Set(durations)).toEqual(new Set([120_000]));
  });
});
