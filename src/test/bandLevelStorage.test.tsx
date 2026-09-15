import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveSession } from '@/components/ActiveSession';
import type { WorkoutSession } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));
vi.mock('@/contexts/CustomExercisesContext', () => {
  const exercises: never[] = [];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});

// A built-in band exercise, so the row renders the level picker.
const BAND_ROW = 'band-lat-pulldown';

const bandPicker = () => document.getElementById('input-0-0-weight') as HTMLSelectElement;

function finishSession(onFinish: ReturnType<typeof vi.fn>): WorkoutSession {
  fireEvent.click(screen.getByText('Finish'));
  if (screen.queryByText('Save short workout?')) fireEvent.click(screen.getByText('Save'));
  expect(onFinish).toHaveBeenCalledTimes(1);
  return onFinish.mock.calls[0][0] as WorkoutSession;
}

describe('a band set stores its level, not a converted mass', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it.each(['lbs', 'kg'] as const)('saves the picked level as-is for a %s user', unit => {
    const onFinish = vi.fn();
    render(<ActiveSession exercises={[BAND_ROW]} weightUnit={unit} onFinish={onFinish} onCancel={vi.fn()} />);

    fireEvent.change(bandPicker(), { target: { value: '6' } });
    fireEvent.change(document.getElementById('tutorial-reps-input')!, { target: { value: '10' } });
    fireEvent.click(screen.getByTestId('set-complete-0-0'));

    const session = finishSession(onFinish);
    // Level 6 for an lbs user used to land as 2.72 (6 ÷ 2.20462).
    expect(session.exercises[0].sets[0]).toMatchObject({ weight: 6, reps: 10 });
  });

  it('reopens an older session whose level went through the kg conversion on the right level', () => {
    const editSession: WorkoutSession = {
      id: 'ws-1', date: '2026-08-26', duration: 1800, totalVolume: 0, totalSets: 1, totalReps: 10,
      exercises: [{ exerciseId: BAND_ROW, exerciseName: 'Band Lat Pulldown', sets: [{ setNumber: 1, type: 'normal', reps: 10, weight: 2.72 }] }],
    };
    render(<ActiveSession exercises={[]} weightUnit="lbs" editSession={editSession} onFinish={vi.fn()} onCancel={vi.fn()} />);

    expect(bandPicker().value).toBe('6');
  });

  it('prefills the picker from a template target stored either way', () => {
    render(
      <ActiveSession
        exercises={[BAND_ROW]}
        templateExercises={[{ exerciseId: BAND_ROW, sets: 1, targetReps: 10, setType: 'normal', restSeconds: 60, targetWeight: 2.72 }]}
        templateName="Bands"
        weightUnit="lbs"
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(bandPicker().value).toBe('6');
  });
});
