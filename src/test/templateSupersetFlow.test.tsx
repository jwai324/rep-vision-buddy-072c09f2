import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import { ActiveSession } from '@/components/ActiveSession';
import type { WorkoutSession, WorkoutTemplate } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));
vi.mock('@/contexts/CustomExercisesContext', () => {
  // One array for the whole run: the provider hands out a stable one, and the
  // builder's name re-resolve effect keys on it.
  const exercises: never[] = [];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});

const BENCH = 'flat-barbell-bench-press';
const ROW = 'barbell-bent-over-row';
const FLY = 'dumbbell-fly';

/** A template whose superset exists only as a set type — the shape the AI
 *  tools write, and the shape the old builder pill produced. */
const supersetByTypeOnly: WorkoutTemplate = {
  id: 'tpl-ss',
  name: 'Upper',
  exercises: [
    { exerciseId: BENCH, sets: 2, targetReps: 10, setType: 'superset', restSeconds: 60, targetWeight: 60 },
    { exerciseId: ROW, sets: 2, targetReps: 10, setType: 'superset', restSeconds: 60, targetWeight: 60 },
    { exerciseId: FLY, sets: 2, targetReps: 12, setType: 'normal', restSeconds: 60, targetWeight: 10 },
  ],
};

describe('supersets in the template builder', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it('no longer offers Superset as a per-exercise set type', () => {
    render(<TemplateBuilder initial={supersetByTypeOnly} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getAllByText('Normal').length).toBe(3);
    expect(screen.queryByText('Superset')).toBeNull();
  });

  it('saves a set-type-only superset as an explicit link between the two exercises', () => {
    const onSave = vi.fn();
    render(<TemplateBuilder initial={supersetByTypeOnly} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('Save Template'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as WorkoutTemplate;
    expect(saved.exercises.map(e => e.supersetGroup)).toEqual([1, 1, undefined]);
    expect(saved.exercises.map(e => e.setType)).toEqual(['superset', 'superset', 'normal']);
  });

  it('keeps an explicit link and its more specific set type on save', () => {
    const onSave = vi.fn();
    const linked: WorkoutTemplate = {
      ...supersetByTypeOnly,
      exercises: [
        { exerciseId: BENCH, sets: 2, targetReps: 10, setType: 'normal', restSeconds: 60, supersetGroup: 2 },
        { exerciseId: ROW, sets: 2, targetReps: 'failure', setType: 'failure', restSeconds: 60, supersetGroup: 2 },
      ],
    };
    render(<TemplateBuilder initial={linked} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('Save Template'));

    const saved = onSave.mock.calls[0][0] as WorkoutTemplate;
    expect(saved.exercises.map(e => e.supersetGroup)).toEqual([2, 2]);
    expect(saved.exercises.map(e => e.setType)).toEqual(['superset', 'failure']);
    expect(saved.exercises[1].targetReps).toBe('failure');
  });
});

function finishSession(onFinish: ReturnType<typeof vi.fn>): WorkoutSession {
  fireEvent.click(screen.getByText('Finish'));
  if (screen.queryByText('Save short workout?')) fireEvent.click(screen.getByText('Save'));
  expect(onFinish).toHaveBeenCalledTimes(1);
  return onFinish.mock.calls[0][0] as WorkoutSession;
}

describe('supersets carried from a template into the live session', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it('links the exercises in the session when the template only typed them as supersets', () => {
    const onFinish = vi.fn();
    render(
      <ActiveSession
        exercises={supersetByTypeOnly.exercises.map(e => e.exerciseId)}
        templateExercises={supersetByTypeOnly.exercises}
        templateName="Upper"
        onFinish={onFinish}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('set-complete-0-0'));
    fireEvent.click(screen.getByTestId('set-complete-1-0'));
    fireEvent.click(screen.getByTestId('set-complete-2-0'));

    const session = finishSession(onFinish);
    expect(session.exercises.map(e => e.exerciseId)).toEqual([BENCH, ROW, FLY]);
    expect(session.exercises.map(e => e.supersetGroup)).toEqual([1, 1, undefined]);
  });

  it('carries an explicit link through untouched', () => {
    const onFinish = vi.fn();
    const exercises = [
      { ...supersetByTypeOnly.exercises[0], setType: 'normal' as const, supersetGroup: 4 },
      { ...supersetByTypeOnly.exercises[1], setType: 'normal' as const, supersetGroup: 4 },
    ];
    render(
      <ActiveSession
        exercises={exercises.map(e => e.exerciseId)}
        templateExercises={exercises}
        onFinish={onFinish}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('set-complete-0-0'));
    fireEvent.click(screen.getByTestId('set-complete-1-0'));

    const session = finishSession(onFinish);
    expect(session.exercises.map(e => e.supersetGroup)).toEqual([4, 4]);
  });

  it('does not offer a template update for a superset template run exactly as planned', () => {
    const onFinish = vi.fn();
    const onUpdateTemplate = vi.fn();
    render(
      <ActiveSession
        exercises={supersetByTypeOnly.exercises.map(e => e.exerciseId)}
        templateExercises={supersetByTypeOnly.exercises}
        templateId={supersetByTypeOnly.id}
        template={supersetByTypeOnly}
        onFinish={onFinish}
        onCancel={vi.fn()}
        onUpdateTemplate={onUpdateTemplate}
      />,
    );
    for (const block of [0, 1, 2]) {
      fireEvent.click(screen.getByTestId(`set-complete-${block}-0`));
      fireEvent.click(screen.getByTestId(`set-complete-${block}-1`));
    }

    finishSession(onFinish);
    expect(screen.queryByText('Update template?')).toBeNull();
    expect(onUpdateTemplate).not.toHaveBeenCalled();
  });
});

describe('discarding a live workout', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it('asks a plain yes/no and discards on yes', () => {
    const onCancel = vi.fn();
    render(<ActiveSession exercises={[BENCH]} onFinish={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).queryByRole('textbox')).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByText('Discard'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('keeps the workout on cancel', () => {
    const onCancel = vi.fn();
    render(<ActiveSession exercises={[BENCH]} onFinish={vi.fn()} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByText('Cancel'));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
