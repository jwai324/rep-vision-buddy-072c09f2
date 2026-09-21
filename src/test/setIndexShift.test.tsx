import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, screen, fireEvent } from '@testing-library/react';
import { useBlockMutations } from '@/hooks/useBlockMutations';
import { ActiveSession } from '@/components/ActiveSession';
import type { ActiveSessionCache, ExerciseBlock } from '@/types/activeSession';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('sonner', () => ({
  toast: Object.assign(toastMock, { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
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
const SQUAT = 'barbell-back-squat';

function makeBlock(): ExerciseBlock {
  return {
    exerciseId: BENCH as ExerciseBlock['exerciseId'],
    exerciseName: 'Bench',
    restSeconds: 90,
    sets: [
      { setNumber: 1, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal' },
      { setNumber: 2, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal' },
      { setNumber: 3, weight: '', reps: '', rpe: '', time: '', completed: false, type: 'normal' },
    ],
  };
}

describe('useBlockMutations reports how a mutation moves indices', () => {
  const setup = () => {
    let blocks: ExerciseBlock[] = [makeBlock(), { ...makeBlock(), exerciseId: SQUAT as ExerciseBlock['exerciseId'] }];
    const setBlocks = (updater: React.SetStateAction<ExerciseBlock[]>) => {
      blocks = typeof updater === 'function' ? updater(blocks) : updater;
    };
    const onSetIndicesShifted = vi.fn();
    const onBlockIndicesShifted = vi.fn();
    const { result } = renderHook(() =>
      useBlockMutations(blocks, setBlocks, {
        weightUnit: 'kg',
        defaultDropSetsEnabled: false,
        defaultRestSeconds: 90,
        customExercises: [],
        startTimer: vi.fn(),
        onSetIndicesShifted,
        onBlockIndicesShifted,
      }),
    );
    return { result, onSetIndicesShifted, onBlockIndicesShifted };
  };

  beforeEach(() => toastMock.mockClear());

  it('a warm-up pushes every row of its block down by one', () => {
    const { result, onSetIndicesShifted } = setup();
    act(() => result.current.addWarmupSet(1));
    const [blockIdx, remap] = onSetIndicesShifted.mock.calls[0];
    expect(blockIdx).toBe(1);
    expect([0, 1, 2].map(remap)).toEqual([1, 2, 3]);
  });

  it('deleting a row drops it and pulls the rows below it up; undo puts them back', () => {
    const { result, onSetIndicesShifted } = setup();
    act(() => result.current.removeSet(0, 1));
    const [, remap] = onSetIndicesShifted.mock.calls[0];
    expect([0, 1, 2].map(remap)).toEqual([0, null, 1]);

    act(() => toastMock.mock.calls[0][1].action.onClick());
    const [, undoRemap] = onSetIndicesShifted.mock.calls[1];
    expect([0, 1].map(undoRemap)).toEqual([0, 2]);
  });

  it('removing an exercise drops its block and pulls the later ones up', () => {
    const { result, onBlockIndicesShifted } = setup();
    act(() => result.current.removeExercise(0));
    const [remap] = onBlockIndicesShifted.mock.calls[0];
    expect([0, 1].map(remap)).toEqual([null, 0]);
  });
});

describe('a stopwatch set follows its row when rows move', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  const startSetOn = (startButton: HTMLElement) => {
    fireEvent.click(startButton);
    // The countdown re-arms its timeout from an effect, so it is walked one
    // second at a time.
    for (let i = 0; i < 6; i++) act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Stop set')).toBeInTheDocument();
  };

  const openMenuBeside = (headerButton: HTMLElement) => {
    const trigger = headerButton.parentElement!.querySelector('button[aria-haspopup="dialog"]');
    fireEvent.click(trigger!);
  };

  const cachedBlocks = (): ExerciseBlock[] => {
    act(() => { vi.advanceTimersByTime(600); });
    const cache = JSON.parse(localStorage.getItem(ACTIVE_SESSION_CACHE_KEY)!) as ActiveSessionCache;
    return cache.blocks;
  };

  it('Add Warm-up Sets while a set runs: Stop lands on the working set, not the warm-up', () => {
    render(
      <ActiveSession
        exercises={[BENCH]}
        templateExercises={[{ exerciseId: BENCH, sets: 2, targetReps: 10, setType: 'normal', restSeconds: 60 }]}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    startSetOn(screen.getByText('Start next set'));

    openMenuBeside(screen.getByText('Stop set'));
    fireEvent.click(screen.getByText('Add Warm-up Sets'));
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.click(screen.getByText('Stop set'));

    const sets = cachedBlocks()[0].sets;
    expect(sets.map(s => s.type)).toEqual(['warmup', 'normal', 'normal']);
    expect(sets[0].completed).toBe(false);
    expect(sets[0].time).toBe('');
    expect(sets[1].completed).toBe(true);
    expect(sets[1].time).not.toBe('');
  });

  it('removing the exercise above a running set: Stop lands on the exercise that was running', () => {
    render(
      <ActiveSession
        exercises={[BENCH, SQUAT]}
        templateExercises={[
          { exerciseId: BENCH, sets: 2, targetReps: 10, setType: 'normal', restSeconds: 60 },
          { exerciseId: SQUAT, sets: 2, targetReps: 10, setType: 'normal', restSeconds: 60 },
        ]}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    startSetOn(screen.getAllByText('Start next set')[1]);

    openMenuBeside(screen.getByText('Start next set'));
    fireEvent.click(screen.getByText('Remove Exercise'));
    fireEvent.click(screen.getByText('Remove'));
    expect(screen.getByText('Stop set')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.click(screen.getByText('Stop set'));

    const blocks = cachedBlocks();
    expect(blocks.map(b => b.exerciseId)).toEqual([SQUAT]);
    expect(blocks[0].sets[0].completed).toBe(true);
    expect(blocks[0].sets[0].time).not.toBe('');
  });
});
