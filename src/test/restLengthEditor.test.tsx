import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { toast } from 'sonner';
import { ActiveSession } from '@/components/ActiveSession';
import type { ActiveSessionCache } from '@/types/activeSession';
import type { ExerciseId, WorkoutSession } from '@/types/workout';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';

const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker {
    onmessage: ((e: MessageEvent) => void) | null = null;
    postMessage() { /* noop */ }
    terminate() { /* noop */ }
  }
  return { FakeWorker };
});

vi.mock('@/workers/restTimerWorker?worker', () => ({ default: FakeWorker }));
vi.mock('@/utils/restTimerSound', () => ({
  scheduleRestTimerSound: vi.fn(() => vi.fn()),
  playRestTimerSoundNow: vi.fn(),
}));
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

const BENCH = 'flat-barbell-bench-press' as ExerciseId;
const INCLINE = 'incline-dumbbell-press' as ExerciseId;
const BENCH_NAME = 'Flat Barbell Bench Press';
const INCLINE_NAME = 'Incline Dumbbell Press';

const renderLive = (defaultRestSeconds = 90) =>
  render(
    <ActiveSession
      exercises={[BENCH, INCLINE]}
      weightUnit="lbs"
      defaultRestSeconds={defaultRestSeconds}
      onFinish={vi.fn()}
      onCancel={vi.fn()}
    />,
  );

const openMenu = (exerciseName: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Options for ${exerciseName}` }));

const openRestEditor = (exerciseName: string) => {
  openMenu(exerciseName);
  fireEvent.click(screen.getByText('Update Rest Timer'));
};

const restInput = () => screen.getByLabelText('Rest seconds') as HTMLInputElement;

const setRestTo = (value: string) => {
  fireEvent.change(restInput(), { target: { value } });
  fireEvent.click(screen.getByText('Save'));
};

/** The rest bars, top to bottom: two per exercise for a three-set block. */
const startRestBars = () => screen.getAllByText('Start Rest');

describe('the in-session rest-length editor', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it('opens seeded with the exercise\'s current rest', () => {
    renderLive(75);
    openRestEditor(BENCH_NAME);

    expect(screen.getByText('⏱️ Rest Timer')).toBeInTheDocument();
    expect(restInput().value).toBe('75');
  });

  it('changes only the exercise it was opened for', () => {
    renderLive(75);
    openRestEditor(BENCH_NAME);
    setRestTo('120');

    // The dialog closed on save, and the new length is what it reopens with.
    expect(screen.queryByText('⏱️ Rest Timer')).toBeNull();
    openRestEditor(BENCH_NAME);
    expect(restInput().value).toBe('120');
    fireEvent.click(screen.getByText('Cancel'));

    openRestEditor(INCLINE_NAME);
    expect(restInput().value).toBe('75');
  });

  it('starts the next rest at the new length', () => {
    renderLive(75);
    openRestEditor(BENCH_NAME);
    setRestTo('120');

    fireEvent.click(startRestBars()[0]);
    expect(screen.getByText('2:00')).toBeInTheDocument();
  });

  it('leaves a rest that is already running on its own countdown', () => {
    renderLive(75);
    fireEvent.click(startRestBars()[0]);
    expect(screen.getByText('1:15')).toBeInTheDocument();

    openRestEditor(BENCH_NAME);
    setRestTo('300');

    // Still the rest it started as; the new length is for the next one.
    expect(screen.getByText('1:15')).toBeInTheDocument();
    expect(screen.queryByText('5:00')).toBeNull();
  });

  it('refuses a rest below the floor or above the ceiling, and keeps the dialog open', () => {
    renderLive(75);

    for (const bad of ['4', '901', '', '45.5']) {
      openRestEditor(BENCH_NAME);
      setRestTo(bad);
      expect(toast.error).toHaveBeenCalledWith('Rest must be a whole number of seconds from 5 to 900.');
      expect(restInput()).toBeInTheDocument();
      fireEvent.click(screen.getByText('Cancel'));
      vi.mocked(toast.error).mockClear();
    }

    openRestEditor(BENCH_NAME);
    expect(restInput().value).toBe('75');
  });

  it('accepts the bounds themselves and the one-tap presets', () => {
    renderLive(75);
    openRestEditor(BENCH_NAME);
    setRestTo('5');
    openRestEditor(BENCH_NAME);
    expect(restInput().value).toBe('5');

    fireEvent.click(screen.getByText('180s'));
    fireEvent.click(screen.getByText('Save'));
    openRestEditor(BENCH_NAME);
    expect(restInput().value).toBe('180');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('changes nothing when the dialog is cancelled', () => {
    renderLive(75);
    openRestEditor(BENCH_NAME);
    fireEvent.change(restInput(), { target: { value: '240' } });
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText('⏱️ Rest Timer')).toBeNull();
    openRestEditor(BENCH_NAME);
    expect(restInput().value).toBe('75');
  });

  it('opens above Focus Mode, which offers the same menu', () => {
    // Focus Mode is an opaque `fixed inset-0 z-50` overlay rendering the same
    // three-dot menu, so a dialog at its level opens underneath it — which is
    // the "tap does nothing" this item exists to fix.
    renderLive(75);
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    const focus = screen.getByText('Focus Mode').closest('.fixed') as HTMLElement;

    fireEvent.click(within(focus).getByRole('button', { name: `Options for ${BENCH_NAME}` }));
    fireEvent.click(screen.getByText('Update Rest Timer'));

    // jsdom paints nothing and loads no Tailwind, so the stacking itself is
    // asserted on the classes that decide it.
    const dialog = screen.getByText('⏱️ Rest Timer').closest('.fixed') as HTMLElement;
    expect(dialog.className).toContain('z-[70]');
    expect(focus.className).toMatch(/\bz-50\b/);

    expect(restInput().value).toBe('75');
    setRestTo('120');

    // Focus Mode is still up, and the exercise's rest really changed.
    expect(screen.getByText('Focus Mode')).toBeInTheDocument();
    fireEvent.click(within(focus).getByRole('button', { name: `Options for ${BENCH_NAME}` }));
    fireEvent.click(screen.getByText('Update Rest Timer'));
    expect(restInput().value).toBe('120');
  });

  it('survives minimizing and resuming the workout', () => {
    const first = renderLive(75);
    openRestEditor(BENCH_NAME);
    setRestTo('120');

    // pagehide flushes the debounced cache write the same way minimizing does.
    fireEvent(window, new Event('pagehide'));
    const cache = JSON.parse(localStorage.getItem(ACTIVE_SESSION_CACHE_KEY) ?? 'null') as ActiveSessionCache;
    first.unmount();

    render(
      <ActiveSession
        exercises={[BENCH, INCLINE]}
        weightUnit="lbs"
        defaultRestSeconds={75}
        cachedSession={cache}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    openRestEditor(BENCH_NAME);
    expect(restInput().value).toBe('120');
  });

  it('is not offered while editing a past workout', () => {
    // A record has no rest to run: its bars are not rendered and its timer is
    // a no-op, so the item would silently do nothing.
    const past: WorkoutSession = {
      id: 'sess-1',
      date: '2026-09-10',
      startedAt: '2026-09-10T18:05:00.000Z',
      duration: 1960,
      location: 'Commercial Gym',
      isRestDay: false,
      exercises: [{
        exerciseId: BENCH, exerciseName: BENCH_NAME,
        sets: [{ setNumber: 1, type: 'normal', reps: 8, weight: 60 }],
      }],
      totalVolume: 480, totalSets: 1, totalReps: 8,
    };
    render(<ActiveSession exercises={[]} editSession={past} onFinish={vi.fn()} onCancel={vi.fn()} />);

    openMenu(BENCH_NAME);
    expect(screen.getByText('Add Note')).toBeInTheDocument();
    expect(screen.queryByText('Update Rest Timer')).toBeNull();
    expect(screen.queryByText('⏱️ Rest Timer')).toBeNull();
  });
});
