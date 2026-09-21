import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ActiveSession } from '@/components/ActiveSession';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import type { ActiveSessionCache } from '@/types/activeSession';
import type { WorkoutSession } from '@/types/workout';

/**
 * Custom exercises load from Supabase after mount and have no localStorage
 * cache, so a workout started in that window names its blocks after the raw
 * `custom-<uuid>` id. `ActiveSession` re-resolves its blocks whenever the
 * lookup changes, which is what heals the screen, the session cache and the
 * saved log once the library lands. Every other ActiveSession test pins the
 * custom-exercise context to a static empty list, so the arrival itself has
 * never been exercised — this file makes the library mutable between renders.
 */

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));

// The one thing the existing suite cannot express: a library that is empty on
// mount and populated on a later render, as the real fetch does.
const library = vi.hoisted(() => ({
  exercises: [] as { id: string; name: string; primaryBodyPart: string; equipment: string; measurementType?: string | null }[],
  loading: true,
}));
vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: library.exercises, loading: library.loading,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

const WALL_SIT = 'custom-95ca6d55-1f2b-4a7e-9c31-2d0a1f6b8e44';
const RETIRED = 'custom-0b7d1c92-55aa-4f10-8e6d-7c3b9a04d112';

const wallSitRow = {
  id: WALL_SIT,
  name: 'Wall Sit Hold',
  primaryBodyPart: 'Legs',
  equipment: 'Bodyweight',
  difficulty: 'Beginner',
  exerciseType: 'Isolation',
  movementPattern: 'Squat',
  secondaryMuscles: [],
  measurementType: 'Reps + Weight',
  isCustom: true,
  isRecovery: false,
  excludeFromVolume: false,
};

const arriveWithWallSit = () => {
  library.exercises = [wallSitRow];
  library.loading = false;
};

/** Finish the workout and hand back the session the caller would save. */
function finishSession(onFinish: ReturnType<typeof vi.fn>): WorkoutSession {
  fireEvent.click(screen.getByText('Finish'));
  if (screen.queryByText('Save short workout?')) fireEvent.click(screen.getByText('Save'));
  expect(onFinish).toHaveBeenCalledTimes(1);
  return onFinish.mock.calls[0][0] as WorkoutSession;
}

/** Force the debounced cache writer to flush and read back what it wrote. */
function flushedCache(): ActiveSessionCache {
  act(() => { window.dispatchEvent(new Event('pagehide')); });
  const raw = localStorage.getItem(ACTIVE_SESSION_CACHE_KEY);
  expect(raw).not.toBeNull();
  return JSON.parse(raw!) as ActiveSessionCache;
}

/** Fill set 1 of block 0 and tick it — reps-weight mode gates on both fields. */
const completeFirstSet = (weight: string, reps: string) => {
  fireEvent.change(document.getElementById('tutorial-weight-input')!, { target: { value: weight } });
  fireEvent.change(document.getElementById('tutorial-reps-input')!, { target: { value: reps } });
  fireEvent.click(screen.getByTestId('set-complete-0-0'));
  expect(screen.getByTestId('set-complete-0-0')).toHaveAttribute('aria-pressed', 'true');
};

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  library.exercises = [];
  library.loading = true;
});

describe('a workout started before the custom library lands', () => {
  it('shows the raw id, then the real name once the library arrives', () => {
    const props = {
      exercises: [WALL_SIT],
      onFinish: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = render(<ActiveSession {...props} />);

    // Nothing knows this id yet, so the block was named after it.
    expect(screen.getByRole('button', { name: WALL_SIT })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wall Sit Hold' })).toBeNull();

    arriveWithWallSit();
    rerender(<ActiveSession {...props} />);

    expect(screen.getByRole('button', { name: 'Wall Sit Hold' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: WALL_SIT })).toBeNull();
    // The exercise menu is labelled from the same name, so the repair reaches
    // every reader of the block rather than just the title.
    expect(screen.getByRole('button', { name: 'Options for Wall Sit Hold' })).toBeTruthy();
  });

  it('saves the healed name into the log, not the raw id', () => {
    const onFinish = vi.fn();
    const props = { exercises: [WALL_SIT], onFinish, onCancel: vi.fn() };
    const { rerender } = render(<ActiveSession {...props} />);

    // The set is logged while the block still carries the id as its name.
    completeFirstSet('40', '12');

    arriveWithWallSit();
    rerender(<ActiveSession {...props} />);

    const session = finishSession(onFinish);
    expect(session.exercises).toHaveLength(1);
    expect(session.exercises[0].exerciseId).toBe(WALL_SIT);
    expect(session.exercises[0].exerciseName).toBe('Wall Sit Hold');
  });

  it('heals the session cache too, so a resumed workout does not carry the id back', () => {
    const props = { exercises: [WALL_SIT], onFinish: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<ActiveSession {...props} />);

    completeFirstSet('40', '12');
    // The cache written before the library landed is the one that used to
    // persist the raw id into the resumed session and everything downstream.
    expect(flushedCache().blocks[0].exerciseName).toBe(WALL_SIT);

    arriveWithWallSit();
    rerender(<ActiveSession {...props} />);

    expect(flushedCache().blocks[0].exerciseName).toBe('Wall Sit Hold');
  });

  it('adopts a rename made in the library without touching the id', () => {
    const props = { exercises: [WALL_SIT], onFinish: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<ActiveSession {...props} />);

    arriveWithWallSit();
    rerender(<ActiveSession {...props} />);
    expect(screen.getByRole('button', { name: 'Wall Sit Hold' })).toBeTruthy();

    library.exercises = [{ ...wallSitRow, name: 'Wall Sit (isometric)' }];
    rerender(<ActiveSession {...props} />);

    expect(screen.getByRole('button', { name: 'Wall Sit (isometric)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Wall Sit Hold' })).toBeNull();
  });
});

describe('an id the library no longer knows', () => {
  // A deleted custom exercise: the row is the only record of what it was
  // called, so the stored name is kept rather than reverting to the id.
  const mixedCache = (): ActiveSessionCache => ({
    workoutName: 'Rehab',
    startTimestamp: Date.now() - 60_000,
    elapsedAtCache: 60,
    blocks: [
      {
        exerciseId: WALL_SIT,
        // Created before the library loaded, so the id is standing in as the name.
        exerciseName: WALL_SIT,
        restSeconds: 60,
        sets: [{ setNumber: 1, weight: '0', reps: '20', completed: false, type: 'normal', rpe: '', time: '' }],
      },
      {
        exerciseId: RETIRED,
        exerciseName: 'Retired Lift',
        restSeconds: 60,
        sets: [{ setNumber: 1, weight: '25', reps: '8', completed: false, type: 'normal', rpe: '', time: '' }],
      },
    ],
  });

  it('keeps the stored name while healing the block beside it', () => {
    const cache = mixedCache();
    const props = { exercises: [], cachedSession: cache, onFinish: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(<ActiveSession {...props} />);

    expect(screen.getByRole('button', { name: WALL_SIT })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retired Lift' })).toBeTruthy();

    arriveWithWallSit();
    rerender(<ActiveSession {...props} />);

    expect(screen.getByRole('button', { name: 'Wall Sit Hold' })).toBeTruthy();
    // Not replaced by its own id, and not by the other exercise's name.
    expect(screen.getByRole('button', { name: 'Retired Lift' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: RETIRED })).toBeNull();
  });

  it('carries the stored name through to the log', () => {
    const onFinish = vi.fn();
    const props = { exercises: [], cachedSession: mixedCache(), onFinish, onCancel: vi.fn() };
    const { rerender } = render(<ActiveSession {...props} />);

    arriveWithWallSit();
    rerender(<ActiveSession {...props} />);

    // One set under each block, so both reach the log.
    fireEvent.click(screen.getByTestId('set-complete-0-0'));
    fireEvent.click(screen.getByTestId('set-complete-1-0'));

    const session = finishSession(onFinish);
    expect(session.exercises.map(l => [l.exerciseId, l.exerciseName])).toEqual([
      [WALL_SIT, 'Wall Sit Hold'],
      [RETIRED, 'Retired Lift'],
    ]);
  });
});
