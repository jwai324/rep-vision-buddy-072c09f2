import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ActiveSession } from '@/components/ActiveSession';
import type { WorkoutTemplate } from '@/types/workout';
import { toast } from 'sonner';

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

const template: WorkoutTemplate = {
  id: 'tpl-1',
  name: 'Push',
  exercises: [{
    exerciseId: 'flat-barbell-bench-press',
    sets: 3,
    targetReps: 10,
    setType: 'normal',
    restSeconds: 90,
    targetWeight: 61.23, // 135 lbs
  }],
};

/** A session resumed from the localStorage cache — the shape a workout has
 *  after the PWA is reloaded mid-workout, which is when this prompt matters. */
const resumedCache = {
  blocks: [{
    exerciseId: 'flat-barbell-bench-press',
    exerciseName: 'Bench Press',
    restSeconds: 90,
    sets: [
      { setNumber: 1, weight: '145', reps: '10', rpe: '', time: '', completed: true, type: 'normal' },
      { setNumber: 2, weight: '145', reps: '10', rpe: '', time: '', completed: true, type: 'normal' },
    ],
  }],
  workoutName: 'Push',
  startTimestamp: Date.now() - 3_600_000,
  elapsedAtCache: 3600,
  templateSnapshot: [{
    exerciseId: 'flat-barbell-bench-press', setCount: 3, targetReps: 10,
    setType: 'normal' as const, targetWeight: 61.23,
  }],
  templateId: 'tpl-1',
};

function renderResumed(overrides: Record<string, unknown> = {}) {
  const props = {
    onFinish: vi.fn(),
    onCancel: vi.fn(),
    onUpdateTemplate: vi.fn(),
    ...overrides,
  };
  render(
    <ActiveSession
      exercises={[] as never}
      templateId="tpl-1"
      template={template}
      weightUnit="lbs"
      cachedSession={resumedCache as never}
      onFinish={props.onFinish as never}
      onCancel={props.onCancel as never}
      onUpdateTemplate={props.onUpdateTemplate as never}
    />,
  );
  fireEvent.click(screen.getByText('Finish'));
  if (screen.queryByText('Save short workout?')) fireEvent.click(screen.getByText('Save'));
  return props;
}

describe('update-template prompt at finish', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it('offers the update for a session resumed after a reload', () => {
    renderResumed();
    expect(screen.getByText('Update template?')).toBeInTheDocument();
  });

  it('hands the changed template to onUpdateTemplate', () => {
    const { onUpdateTemplate } = renderResumed();
    fireEvent.click(screen.getByText('Update template'));

    expect(onUpdateTemplate).toHaveBeenCalledTimes(1);
    const saved = (onUpdateTemplate as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkoutTemplate;
    expect(saved.id).toBe('tpl-1');
    expect(saved.exercises[0].sets).toBe(2);
    // 145 lbs, the load actually worked, not the template's 135.
    expect(saved.exercises[0].targetWeight).toBeCloseTo(65.77, 1);
  });

  it('finishes the workout exactly once per decision', () => {
    // Radix fires onOpenChange as the dialog closes behind the button, and the
    // state the click handler cleared is still set in that render's closure.
    const { onFinish } = renderResumed();
    fireEvent.click(screen.getByText('Update template'));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('finishes once when the template is kept', () => {
    const { onFinish, onUpdateTemplate } = renderResumed();
    fireEvent.click(screen.getByText('Keep template'));
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onUpdateTemplate).not.toHaveBeenCalled();
  });

  it('waits for the save before claiming the template was updated', async () => {
    let settle: (ok: boolean) => void = () => {};
    const onUpdateTemplate = vi.fn(() => new Promise<boolean>(res => { settle = res; }));
    renderResumed({ onUpdateTemplate });

    fireEvent.click(screen.getByText('Update template'));
    expect(toast.success).not.toHaveBeenCalled();

    settle(true);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Template updated'));
  });

  it('does not claim success when the save fails', async () => {
    const onUpdateTemplate = vi.fn(async () => false);
    renderResumed({ onUpdateTemplate });

    fireEvent.click(screen.getByText('Update template'));
    await waitFor(() => expect(onUpdateTemplate).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('reports a save that throws instead of finishing silently', async () => {
    const onUpdateTemplate = vi.fn(async () => { throw new Error('offline'); });
    const { onFinish } = renderResumed({ onUpdateTemplate });

    fireEvent.click(screen.getByText('Update template'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Failed to update template'));
    expect(toast.success).not.toHaveBeenCalled();
    // The workout itself still finishes — the save is the only thing that failed.
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
