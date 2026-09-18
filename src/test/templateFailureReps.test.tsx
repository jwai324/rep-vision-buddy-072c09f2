import React, { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import { TemplateExerciseEditor } from '@/components/TemplateExerciseEditor';
import { blockToExercise, type TemplateBlock } from '@/utils/templateBlocks';
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

/** The reps cells, one per exercise, top to bottom. They are the only numeric inputs bound to reps. */
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

  it('has no later set to clear: the exercise shows one reps cell and a set count', () => {
    // The builder used to render a cell per set and read only the first back,
    // so clearing set 3 looked like an edit and saved nothing. One row for
    // the whole exercise is the honest shape of what the template can hold.
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template({ targetReps: 10 })} onSave={onSave} onCancel={vi.fn()} />);

    expect(repsCells()).toHaveLength(1);
    expect(screen.getByTestId('set-count')).toHaveTextContent('3 sets');
    expect(screen.queryByText('+ Add Set')).toBeNull();

    expect(saveAndRead(onSave)).toMatchObject({ sets: 3, targetReps: 10 });
  });
});

describe('the one target row per exercise', () => {
  const stepUp = () => fireEvent.click(screen.getByRole('button', { name: /^Add a set to/ }));
  const stepDown = () => fireEvent.click(screen.getByRole('button', { name: /^Remove a set from/ }));

  it('is what a newly added exercise gets, with three sets behind it', () => {
    // The shape the picker creates: three rows, 10 reps, nothing else. The
    // editor is rendered on its own here because the picker lists the whole
    // library, which is too slow under jsdom to drive in a test.
    const fresh: TemplateBlock = {
      exerciseId: BENCH, exerciseName: 'Flat Barbell Bench Press', setType: 'normal', restSeconds: 90,
      sets: Array.from({ length: 3 }, (_, i) => ({ setNumber: i + 1, targetWeight: '', targetReps: '10', targetRpe: '' })),
    };
    const onBlocks = vi.fn<(blocks: TemplateBlock[]) => void>();
    const Harness = () => {
      const [blocks, setBlocks] = useState([fresh]);
      useEffect(() => { onBlocks(blocks); }, [blocks]);
      return <TemplateExerciseEditor blocks={blocks} onChange={setBlocks} />;
    };
    render(<Harness />);

    expect(repsCells()).toHaveLength(1);
    expect(screen.getByTestId('set-count')).toHaveTextContent('3 sets');

    // Typed once, into the only row there is.
    fireEvent.change(repsCells()[0], { target: { value: '8' } });
    const weightCell = screen.getAllByPlaceholderText('—')
      .find(el => (el as HTMLInputElement).inputMode === 'decimal') as HTMLInputElement;
    fireEvent.change(weightCell, { target: { value: '60' } });

    const [block] = onBlocks.mock.lastCall![0];
    expect(block.sets).toHaveLength(3);
    expect(block.sets.map(s => [s.targetWeight, s.targetReps])).toEqual([['60', '8'], ['60', '8'], ['60', '8']]);
    expect(blockToExercise(block)).toMatchObject({ exerciseId: BENCH, sets: 3, targetReps: 8, targetWeight: 60 });
  });

  it('keeps the typed target on every set the stepper adds', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template({ targetReps: 10 })} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(repsCells()[0], { target: { value: '6' } });
    stepUp();
    stepUp();
    expect(screen.getByTestId('set-count')).toHaveTextContent('5 sets');

    // Sets are cloned from the row, so what was typed before the count grew
    // is the target of the new sets too — sets[0] is what is saved, but a
    // draft must not carry rows that disagree with it either.
    const draft = JSON.parse(localStorage.getItem('template_builder_draft')!);
    expect(draft.blocks[0].sets.map((s: { targetReps: string }) => s.targetReps)).toEqual(['6', '6', '6', '6', '6']);
    expect(saveAndRead(onSave)).toMatchObject({ sets: 5, targetReps: 6 });
  });

  it('drops sets from the count and never goes below one', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template({ targetReps: 10 })} onSave={onSave} onCancel={vi.fn()} />);

    stepDown();
    stepDown();
    expect(screen.getByTestId('set-count')).toHaveTextContent('1 set');
    expect(screen.getByRole('button', { name: /^Remove a set from/ })).toBeDisabled();

    expect(saveAndRead(onSave)).toMatchObject({ sets: 1, targetReps: 10 });
  });

  it('turns blank into "Fail" for the whole exercise, not one set of it', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={template({ targetReps: 10 })} onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(repsCells()[0], { target: { value: '' } });
    expect(repsCells()[0].placeholder).toBe('Fail');
    stepUp();

    expect(saveAndRead(onSave)).toMatchObject({ sets: 4, targetReps: 'failure' });
  });
});
