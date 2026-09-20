import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';
import { ActiveSession } from '@/components/ActiveSession';
import type { ActiveSessionCache } from '@/types/activeSession';
import type { TemplateExercise } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
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

const BENCH = 'Flat Barbell Bench Press';

const benchCache = (): ActiveSessionCache => ({
  workoutName: 'Push',
  startTimestamp: Date.now() - 60_000,
  elapsedAtCache: 60,
  blocks: [{
    exerciseId: 'flat-barbell-bench-press',
    exerciseName: BENCH,
    restSeconds: 90,
    dropSetsEnabled: true,
    sets: [
      { setNumber: 1, weight: '100', reps: '5', completed: false, type: 'normal', rpe: '', time: '' },
      {
        setNumber: 2, weight: '110', reps: '5', completed: false, type: 'normal', rpe: '', time: '',
        drops: [{ weight: '95', reps: '8', rpe: '', completed: false, time: '' }],
      },
      { setNumber: 3, weight: '120', reps: '5', completed: false, type: 'normal', rpe: '', time: '' },
    ],
  }],
});

const renderLiveSession = () => render(
  <ActiveSession exercises={[]} cachedSession={benchCache()} onFinish={vi.fn()} onCancel={vi.fn()} />,
);

/** The last `toast(...)` call's options, which is where removeSet hangs Undo. */
function lastToastAction(): { label: string; onClick: () => void } | undefined {
  const calls = vi.mocked(toast).mock.calls;
  const opts = calls.length ? calls[calls.length - 1][1] : undefined;
  return (opts as unknown as { action?: { label: string; onClick: () => void } } | undefined)?.action;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(toast).mockClear();
});

describe('removing a set without a touchscreen', () => {
  it('gives every set row a named remove control that takes the right row', () => {
    renderLiveSession();

    fireEvent.click(screen.getByRole('button', { name: `Remove set 2 in ${BENCH}` }));

    expect(screen.queryByDisplayValue('110')).toBeNull();
    expect(screen.getByDisplayValue('100')).toBeTruthy();
    expect(screen.getByDisplayValue('120')).toBeTruthy();
  });

  it('is a real button in the tab order, reachable and firable from the keyboard', () => {
    renderLiveSession();
    const remove = screen.getByRole('button', { name: `Remove set 3 in ${BENCH}` });

    // A button with no negative tabindex and no disabled state is reached by
    // Tab and activated by Enter or Space by the browser itself.
    expect(remove.tagName).toBe('BUTTON');
    expect(remove.getAttribute('tabindex')).toBeNull();
    expect(remove).not.toBeDisabled();

    remove.focus();
    expect(document.activeElement).toBe(remove);

    fireEvent.click(remove);
    expect(screen.queryByDisplayValue('120')).toBeNull();
  });

  it('goes through the same path as the swipe, Undo included', () => {
    renderLiveSession();

    fireEvent.click(screen.getByRole('button', { name: `Remove set 1 in ${BENCH}` }));
    const action = lastToastAction();
    expect(action?.label).toBe('Undo');

    act(() => action!.onClick());
    expect(screen.getByDisplayValue('100')).toBeTruthy();
  });

  it('gives a drop row its own control, naming the set it hangs off', () => {
    renderLiveSession();

    fireEvent.click(screen.getByRole('button', { name: `Remove drop 1 of set 2 in ${BENCH}` }));

    expect(screen.queryByDisplayValue('95')).toBeNull();
    expect(screen.getByDisplayValue('110')).toBeTruthy();
  });
});

const timeButtonText = (setIdx: number) =>
  document.getElementById(`input-0-${setIdx}-time`)?.textContent;

describe("a template's planned duration", () => {
  it('opens the session with the planned time in the box, in seconds', () => {
    // The template stores 10 in "Time (min)"; the session's field is seconds,
    // so the box must read 10:00 and not 0:10.
    const yoga: TemplateExercise[] = [
      { exerciseId: 'yoga', sets: 2, targetReps: 10, setType: 'normal', restSeconds: 60 },
    ];
    render(
      <ActiveSession
        exercises={['yoga']} templateExercises={yoga}
        templateName="Mobility" templateId="tpl-time"
        onFinish={vi.fn()} onCancel={vi.fn()}
      />,
    );

    expect(timeButtonText(0)).toBe('10:00');
    expect(timeButtonText(1)).toBe('10:00');
  });

  it('carries time and distance together for time-and-distance work', () => {
    const walk: TemplateExercise[] = [
      { exerciseId: 'walking', sets: 1, targetReps: 20, setType: 'normal', restSeconds: 60, targetDistance: 3000 },
    ];
    render(
      <ActiveSession
        exercises={['walking']} templateExercises={walk}
        templateName="Cardio" templateId="tpl-walk"
        onFinish={vi.fn()} onCancel={vi.fn()}
      />,
    );

    expect(timeButtonText(0)).toBe('20:00');
    expect(screen.getByDisplayValue('3')).toBeTruthy();
  });

  it('leaves the time box empty for rep work, whose target is reps not minutes', () => {
    const bench: TemplateExercise[] = [
      { exerciseId: 'flat-barbell-bench-press', sets: 1, targetReps: 10, setType: 'normal', restSeconds: 90 },
    ];
    render(
      <ActiveSession
        exercises={['flat-barbell-bench-press']} templateExercises={bench}
        templateName="Push" templateId="tpl-push"
        onFinish={vi.fn()} onCancel={vi.fn()}
      />,
    );

    expect(timeButtonText(0)).toBe('—');
    expect(screen.getByDisplayValue('10')).toBeTruthy();
  });

  it('leaves the time box empty when the template sets no time target', () => {
    const yogaNoTarget: TemplateExercise[] = [
      { exerciseId: 'yoga', sets: 1, targetReps: 'failure', setType: 'normal', restSeconds: 60 },
    ];
    render(
      <ActiveSession
        exercises={['yoga']} templateExercises={yogaNoTarget}
        templateName="Mobility" templateId="tpl-none"
        onFinish={vi.fn()} onCancel={vi.fn()}
      />,
    );

    expect(timeButtonText(0)).toBe('—');
  });
});
