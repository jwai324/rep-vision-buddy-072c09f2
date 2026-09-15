import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import type { WorkoutTemplate } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));
vi.mock('@/contexts/CustomExercisesContext', () => {
  // Stable array: the builder's name re-resolve effect keys on its identity.
  // No built-in exercise is pure Distance, so the round-trip case below needs a
  // custom one.
  const exercises = [{
    id: 'custom-run', name: 'Trail Run', primaryBodyPart: 'Cardio', equipment: 'None',
    difficulty: 'Beginner', exerciseType: 'Compound', movementPattern: 'Lunge',
    secondaryMuscles: [], measurementType: 'Distance', isRecovery: false,
    excludeFromVolume: false,
  }];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});

const BENCH = 'flat-barbell-bench-press';
const RUN = 'custom-run';

const template = (over: Partial<WorkoutTemplate['exercises'][number]>): WorkoutTemplate => ({
  id: 'tpl-1',
  name: 'Push',
  exercises: [{ exerciseId: BENCH, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90, ...over }],
});

/** The reps cells, top to bottom. They are the only numeric inputs bound to reps. */
const repsCells = () => screen.getAllByPlaceholderText(/^(Fail|—)$/)
  .filter(el => (el as HTMLInputElement).inputMode === 'numeric') as HTMLInputElement[];

const saveAndRead = (onSave: ReturnType<typeof vi.fn>) => {
  fireEvent.click(screen.getByText('Save Template'));
  return (onSave.mock.calls[0][0] as WorkoutTemplate).exercises[0];
};

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('a template set to "failure"', () => {
  it('takes a rep count again once one is typed into the first set', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template({ targetReps: 'failure' })} onSave={onSave} onCancel={vi.fn()} />);

    // A failure template renders blank cells; typing into the first one is the
    // user saying "not to failure any more".
    fireEvent.change(repsCells()[0], { target: { value: '8' } });

    expect(saveAndRead(onSave).targetReps).toBe(8);
  });

  it('keeps the number across a reopen, even on a template carrying the legacy setType', () => {
    // The old per-exercise pill wrote "to failure" into setType as well. The
    // builder must not re-derive the blank cell from it, or the number the user
    // typed is discarded a second time on the next open.
    const first = vi.fn();
    const { unmount } = render(
      <TemplateBuilder initial={template({ targetReps: 'failure', setType: 'failure' })} onSave={first} onCancel={vi.fn()} />,
    );
    fireEvent.change(repsCells()[0], { target: { value: '8' } });
    const saved = saveAndRead(first);
    expect(saved.targetReps).toBe(8);
    unmount();
    localStorage.clear(); // the draft would otherwise mask a bad reload

    const second = vi.fn();
    render(<TemplateBuilder initial={{ id: 'tpl-1', name: 'Push', exercises: [saved] }} onSave={second} onCancel={vi.fn()} />);

    expect(repsCells()[0].value).toBe('8');
    expect(saveAndRead(second).targetReps).toBe(8);
  });

  it('round-trips a distance-only exercise whose target is "failure"', () => {
    // Distance work renders no reps cell, so a blank one there means "no such
    // field". Reading it as "to failure" — or defaulting it to 10 — both
    // rewrite a target the user was never shown.
    const onSave = vi.fn();
    render(
      <TemplateBuilder
        initial={{
          id: 'tpl-d', name: 'Run',
          exercises: [{ exerciseId: RUN, sets: 1, targetReps: 'failure', setType: 'normal', restSeconds: 60 }],
        }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    expect(saveAndRead(onSave).targetReps).toBe('failure');
  });

  it('is still saved as failure when the first cell is left blank', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template({ targetReps: 'failure' })} onSave={onSave} onCancel={vi.fn()} />);

    expect(saveAndRead(onSave).targetReps).toBe('failure');
  });

  it('is what the user gets by clearing the first set of an ordinary template', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template({ targetReps: 10 })} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(repsCells()[0], { target: { value: '' } });

    expect(saveAndRead(onSave).targetReps).toBe('failure');
  });

  it('is NOT what the user gets by clearing a later set', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template({ targetReps: 10 })} onSave={onSave} onCancel={vi.fn()} />);

    // Only the first set's cell decides the saved rep count, so clearing the
    // third must not mark the whole exercise to failure.
    fireEvent.change(repsCells()[2], { target: { value: '' } });

    expect(saveAndRead(onSave).targetReps).toBe(10);
  });
});
