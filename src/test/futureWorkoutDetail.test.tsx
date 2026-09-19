import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FutureWorkout } from '@/types/workout';

const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock('@/contexts/CustomExercisesContext', () => ({ useCustomExercisesContext: () => ({ exercises: [] }) }));
vi.mock('@/hooks/useExerciseLookup', () => ({ useExerciseLookup: () => ({}) }));

const { FutureWorkoutDetail } = await import('@/components/FutureWorkoutDetail');

// Dated in the past and not done, so the missed-workout actions render.
const missed: FutureWorkout = {
  id: 'fw-1',
  programId: '11111111-2222-4333-8444-555555555555',
  date: '2020-01-01',
  templateId: 'tpl-1',
  label: 'Push Day',
  completed: false,
};

const settle = () => new Promise(r => setTimeout(r, 0));

function renderSkip(onDelete: (id: string) => void | Promise<boolean>) {
  const onBack = vi.fn();
  render(
    <FutureWorkoutDetail
      futureWorkout={missed}
      template={null}
      onPerformWorkout={vi.fn()}
      onDeleteFutureWorkout={onDelete}
      onBack={onBack}
    />,
  );
  fireEvent.click(screen.getByText('Skip workout'));
  fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
  return onBack;
}

beforeEach(() => {
  toastSuccess.mockClear();
});

// The screen used to say "skipped" and close before the delete had resolved,
// so a refused delete was contradicted a moment later by an error toast over
// a calendar that still held the workout.
describe('skipping a missed workout', () => {
  it('says done and leaves once the delete has landed', async () => {
    const onDelete = vi.fn().mockResolvedValue(true);
    const onBack = renderSkip(onDelete);

    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(onDelete).toHaveBeenCalledWith('fw-1');
    expect(toastSuccess).toHaveBeenCalledWith('Workout skipped');
  });

  it('stays put and says nothing when the delete did not land', async () => {
    const onDelete = vi.fn().mockResolvedValue(false);
    const onBack = renderSkip(onDelete);

    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('fw-1'));
    await settle();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('does not leave before the delete has resolved', async () => {
    let resolve!: (ok: boolean) => void;
    const onDelete = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
    const onBack = renderSkip(onDelete);

    await settle();
    expect(onBack).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();

    resolve(true);
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });

  it('treats a handler that returns nothing as done', async () => {
    const onBack = renderSkip(vi.fn());

    await waitFor(() => expect(onBack).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith('Workout skipped');
  });
});
