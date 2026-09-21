import React, { useCallback, useReducer, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
import { useBlockMutations } from '@/hooks/useBlockMutations';
import type { DropRow, ExerciseBlock, SetRow } from '@/types/activeSession';
import type { CustomExercise } from '@/hooks/useCustomExercises';
import type { WeightUnit } from '@/hooks/useStorage';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

const BENCH = 'flat-barbell-bench-press';
const INCLINE = 'incline-barbell-bench-press';
const SQUAT = 'back-squat';

// ---------------------------------------------------------------------------
// Harness
//
// The hook is driven through a real React `useState`, the same way
// `ActiveSession` drives it, and every mutation is dispatched with the fiber
// already holding pending work (`markPendingWork`, standing in for the
// rest-timer tick named in `removeSet`'s comment). That is the condition under
// which React does *not* eagerly evaluate a `useState` updater: it queues it and
// runs it during the next render instead. A function that reads a value from
// inside its updater and uses it outside therefore sees `undefined` here, which
// is exactly the bug class the synchronous stand-in in rpeAutoCopy.test.tsx
// cannot fail on.
//
// `setBlocks` is wrapped only to observe: it records, for each dispatch,
// whether the updater had run by the time the dispatch returned. The
// `updaterRanInline` assertion below is the harness's own proof that it defers.
// ---------------------------------------------------------------------------

interface SetupOptions {
  weightUnit?: WeightUnit;
  defaultDropSetsEnabled?: boolean;
  defaultRestSeconds?: number;
  customExercises?: CustomExercise[];
}

function setup(initial: ExerciseBlock[], opts: SetupOptions = {}) {
  const onSetIndicesShifted = vi.fn();
  const onBlockIndicesShifted = vi.fn();
  const onDropIndicesShifted = vi.fn();
  const startTimer = vi.fn();
  const updaterRanInline: boolean[] = [];

  const view = renderHook(
    ({ customExercises }: { customExercises: CustomExercise[] }) => {
      const [blocks, rawSetBlocks] = useState<ExerciseBlock[]>(initial);
      const [, markPendingWork] = useReducer((n: number) => n + 1, 0);

      const setBlocks = useCallback<React.Dispatch<React.SetStateAction<ExerciseBlock[]>>>(action => {
        if (typeof action !== 'function') {
          rawSetBlocks(action);
          return;
        }
        let ranInline = false;
        rawSetBlocks(prev => {
          ranInline = true;
          return action(prev);
        });
        updaterRanInline.push(ranInline);
      }, []);

      const ops = useBlockMutations(blocks, setBlocks, {
        weightUnit: opts.weightUnit ?? 'lbs',
        defaultDropSetsEnabled: opts.defaultDropSetsEnabled ?? false,
        defaultRestSeconds: opts.defaultRestSeconds ?? 90,
        customExercises,
        startTimer,
        onSetIndicesShifted,
        onBlockIndicesShifted,
        onDropIndicesShifted,
      });

      return { blocks, markPendingWork, ...ops };
    },
    { initialProps: { customExercises: opts.customExercises ?? [] } },
  );

  type Ops = ReturnType<typeof useBlockMutations> & { blocks: ExerciseBlock[]; markPendingWork: () => void };

  const run = (fn: (ops: Ops) => void) => {
    act(() => {
      const ops = view.result.current as Ops;
      ops.markPendingWork();
      fn(ops);
    });
  };

  return {
    run,
    rerender: view.rerender,
    blocks: () => (view.result.current as Ops).blocks,
    ops: () => view.result.current as Ops,
    onSetIndicesShifted,
    onBlockIndicesShifted,
    onDropIndicesShifted,
    startTimer,
    updaterRanInline,
  };
}

const row = (over: Partial<SetRow> = {}): SetRow => ({
  setNumber: 1, weight: '135', reps: '10', rpe: '', time: '', completed: false, type: 'normal', ...over,
});

const drop = (over: Partial<DropRow> = {}): DropRow => ({ weight: '', reps: '', rpe: '', completed: false, ...over });

function benchBlock(over: Partial<ExerciseBlock> = {}): ExerciseBlock {
  return {
    exerciseId: BENCH,
    exerciseName: 'Flat Barbell Bench Press',
    restSeconds: 90,
    sets: [
      row({ setNumber: 1 }),
      row({ setNumber: 2 }),
      row({ setNumber: 3 }),
    ],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('the harness defers the updater the way React does', () => {
  it('queues every blocks updater instead of running it at dispatch time', () => {
    const h = setup([benchBlock()]);

    h.run(ops => ops.addSet(0));
    h.run(ops => ops.addWarmupSet(0));
    h.run(ops => ops.removeSet(0, 0));

    expect(h.updaterRanInline).toHaveLength(3);
    expect(h.updaterRanInline).toEqual([false, false, false]);
  });
});

describe('adding a set', () => {
  it('appends a row carrying the last set forward and numbering it next', () => {
    const h = setup([benchBlock()]);

    h.run(ops => ops.addSet(0));

    const sets = h.blocks()[0].sets;
    expect(sets).toHaveLength(4);
    expect(sets[3]).toMatchObject({
      setNumber: 4, weight: '135', reps: '10', rpe: '', time: '', completed: false, type: 'normal',
    });
    // The rows already on screen are untouched.
    expect(sets.slice(0, 3).map(s => s.setNumber)).toEqual([1, 2, 3]);
  });

  it('numbers the new row by the working sets only, and never inherits warm-up as a type', () => {
    const h = setup([benchBlock({
      sets: [
        row({ setNumber: 1, type: 'warmup', weight: '45', reps: '12' }),
        row({ setNumber: 1 }),
      ],
    })]);

    h.run(ops => ops.addSet(0));
    // Two working sets after the add, so the new one is number 2, not 3.
    let sets = h.blocks()[0].sets;
    expect(sets[2]).toMatchObject({ setNumber: 2, type: 'normal', weight: '135' });

    const warmupOnly = setup([benchBlock({ sets: [row({ setNumber: 1, type: 'warmup', weight: '45', reps: '12' })] })]);
    warmupOnly.run(ops => ops.addSet(0));
    sets = warmupOnly.blocks()[0].sets;
    expect(sets[1]).toMatchObject({ setNumber: 1, type: 'normal', weight: '45', reps: '12' });
  });

  it('touches only the block it was given', () => {
    const h = setup([benchBlock(), benchBlock({ exerciseId: SQUAT, exerciseName: 'Back Squat' })]);

    h.run(ops => ops.addSet(1));

    expect(h.blocks()[0].sets).toHaveLength(3);
    expect(h.blocks()[1].sets).toHaveLength(4);
  });

  it('moves no existing row, so it reports no index shift', () => {
    const h = setup([benchBlock()]);

    h.run(ops => ops.addSet(0));

    // An append leaves indices 0..n-1 pointing at the same rows, so a running
    // stopwatch needs no remap. Anything reported here would move it wrongly.
    expect(h.onSetIndicesShifted).not.toHaveBeenCalled();
    expect(h.onBlockIndicesShifted).not.toHaveBeenCalled();
    expect(h.onDropIndicesShifted).not.toHaveBeenCalled();
  });
});

describe('adding a drop row', () => {
  it('creates the drops array on a set that has none, and appends to one that has', () => {
    const h = setup([benchBlock({ dropSetsEnabled: true })], { defaultDropSetsEnabled: true });

    expect(h.blocks()[0].sets[0].drops).toBeUndefined();

    h.run(ops => ops.addDrop(0, 0));
    expect(h.blocks()[0].sets[0].drops).toEqual([
      { weight: '', reps: '', rpe: '', completed: false },
    ]);

    h.run(ops => ops.addDrop(0, 0));
    expect(h.blocks()[0].sets[0].drops).toHaveLength(2);
    // Only the set it was given grows drops.
    expect(h.blocks()[0].sets[1].drops).toBeUndefined();
  });

  it('moves no existing drop, so it reports no index shift', () => {
    const h = setup([benchBlock({ dropSetsEnabled: true, sets: [row({ drops: [drop({ weight: '100', reps: '8' })] })] })]);

    h.run(ops => ops.addDrop(0, 0));

    expect(h.blocks()[0].sets[0].drops).toHaveLength(2);
    expect(h.onDropIndicesShifted).not.toHaveBeenCalled();
    expect(h.onSetIndicesShifted).not.toHaveBeenCalled();
  });
});

describe('deleting a drop row', () => {
  it('pulls the drops below it up and reports the move', () => {
    const h = setup([benchBlock({
      dropSetsEnabled: true,
      sets: [row({ drops: [drop({ weight: '100' }), drop({ weight: '90' }), drop({ weight: '80' })] })],
    })]);

    h.run(ops => ops.removeDrop(0, 0, 1));

    expect(h.blocks()[0].sets[0].drops!.map(d => d.weight)).toEqual(['100', '80']);
    expect(h.onDropIndicesShifted).toHaveBeenCalledTimes(1);
    const [blockIdx, setIdx, remap] = h.onDropIndicesShifted.mock.calls[0];
    expect([blockIdx, setIdx]).toEqual([0, 0]);
    expect([0, 1, 2].map(remap)).toEqual([0, null, 1]);
  });

  it('clears the array entirely when the last drop goes', () => {
    const h = setup([benchBlock({ dropSetsEnabled: true, sets: [row({ drops: [drop({ weight: '100' })] })] })]);

    h.run(ops => ops.removeDrop(0, 0, 0));

    // `undefined`, not `[]` — the table renders a drop row for every entry.
    expect(h.blocks()[0].sets[0].drops).toBeUndefined();
    const [, , remap] = h.onDropIndicesShifted.mock.calls[0];
    expect([0].map(remap)).toEqual([null]);
  });

  it('leaves the other sets of the block alone', () => {
    const h = setup([benchBlock({
      dropSetsEnabled: true,
      sets: [
        row({ setNumber: 1, drops: [drop({ weight: '100' })] }),
        row({ setNumber: 2, drops: [drop({ weight: '95' })] }),
      ],
    })]);

    h.run(ops => ops.removeDrop(0, 1, 0));

    expect(h.blocks()[0].sets[0].drops).toHaveLength(1);
    expect(h.blocks()[0].sets[1].drops).toBeUndefined();
    const [, setIdx] = h.onDropIndicesShifted.mock.calls[0];
    expect(setIdx).toBe(1);
  });
});

describe('adding an exercise', () => {
  it('appends a block of three empty sets carrying the session defaults', () => {
    const h = setup([benchBlock()], { defaultRestSeconds: 120, defaultDropSetsEnabled: true });

    h.run(ops => ops.addExercise(SQUAT));

    const blocks = h.blocks();
    expect(blocks.map(b => b.exerciseId)).toEqual([BENCH, SQUAT]);
    expect(blocks[1]).toMatchObject({
      exerciseName: 'Back Squat',
      restSeconds: 120,
      dropSetsEnabled: true,
    });
    expect(blocks[1].sets).toHaveLength(3);
    expect(blocks[1].sets.map(s => s.setNumber)).toEqual([1, 2, 3]);
    expect(blocks[1].sets.every(s => s.weight === '' && s.reps === '' && !s.completed && s.type === 'normal')).toBe(true);
  });

  it('refuses one already in the session, leaving the existing block untouched', () => {
    const h = setup([benchBlock({ sets: [row({ weight: '225', completed: true })] })]);

    h.run(ops => ops.addExercise(BENCH));

    expect(h.blocks()).toHaveLength(1);
    expect(h.blocks()[0].sets[0]).toMatchObject({ weight: '225', completed: true });
  });

  it('adds several at once and drops the duplicates out of the batch', () => {
    const h = setup([benchBlock()]);

    h.run(ops => ops.addMultipleExercises([SQUAT, BENCH, INCLINE]));

    expect(h.blocks().map(b => b.exerciseId)).toEqual([BENCH, SQUAT, INCLINE]);
  });

  it('moves no existing block, so it reports no index shift', () => {
    const h = setup([benchBlock()]);

    h.run(ops => ops.addExercise(SQUAT));

    expect(h.onBlockIndicesShifted).not.toHaveBeenCalled();
    expect(h.onSetIndicesShifted).not.toHaveBeenCalled();
  });

  // The hook builds the new block from `exerciseLookup`, which only knows a
  // custom exercise once the library has loaded. `addExercise` used to be
  // memoized with an empty dependency array over `addMultipleExercises`, so it
  // kept the first render's lookup — and its rest and drop-set defaults — for
  // the life of the session. This test is why that was found.
  it('picks up the exercise lookup that arrives after the first render', () => {
    const h = setup([benchBlock()]);
    const custom: CustomExercise = {
      id: 'custom-1', name: 'Neck Curl', primaryBodyPart: 'Neck', equipment: 'Bodyweight',
      difficulty: 'Beginner', exerciseType: 'Isolation', movementPattern: 'Other',
      secondaryMuscles: [], isCustom: true, isRecovery: false, excludeFromVolume: false,
    };

    h.rerender({ customExercises: [custom] });
    h.run(ops => ops.addExercise('custom-1'));
    expect(h.blocks()[1].exerciseName).toBe('Neck Curl');

    // `addMultipleExercises` is rebuilt on every render and gets it right.
    const direct = setup([benchBlock()]);
    direct.rerender({ customExercises: [custom] });
    direct.run(ops => ops.addMultipleExercises(['custom-1']));
    expect(direct.blocks()[1].exerciseName).toBe('Neck Curl');
  });
});

describe('replacing an exercise', () => {
  it('swaps the id and the resolved name and keeps the rows where they are', () => {
    const h = setup([
      benchBlock({ sets: [row({ setNumber: 1, completed: true }), row({ setNumber: 2 })], note: 'elbows in' }),
      benchBlock({ exerciseId: SQUAT, exerciseName: 'Back Squat' }),
    ]);

    h.run(ops => ops.replaceExercise(0, INCLINE));

    const block = h.blocks()[0];
    expect(block.exerciseId).toBe(INCLINE);
    expect(block.exerciseName).toBe('Incline Barbell Bench Press');
    expect(block.note).toBe('elbows in');
    expect(block.sets).toHaveLength(2);
    expect(block.sets[0]).toMatchObject({ weight: '135', reps: '10', completed: true });
    expect(h.blocks()[1].exerciseId).toBe(SQUAT);
  });

  it('refuses an exercise already in the session and changes nothing', () => {
    const h = setup([
      benchBlock(),
      benchBlock({ exerciseId: SQUAT, exerciseName: 'Back Squat' }),
    ]);
    const before = h.blocks();

    h.run(ops => ops.replaceExercise(0, SQUAT));

    expect(toast.error).toHaveBeenCalledWith('That exercise is already in this session.');
    expect(h.blocks()).toBe(before);
    expect(h.blocks().map(b => b.exerciseId)).toEqual([BENCH, SQUAT]);
  });

  it('allows replacing a block with the exercise it already holds', () => {
    const h = setup([benchBlock(), benchBlock({ exerciseId: SQUAT, exerciseName: 'Back Squat' })]);

    h.run(ops => ops.replaceExercise(0, BENCH));

    expect(toast.error).not.toHaveBeenCalled();
    expect(h.blocks().map(b => b.exerciseId)).toEqual([BENCH, SQUAT]);
  });

  it('ignores an out-of-range block index', () => {
    const h = setup([benchBlock()]);
    const before = h.blocks();

    h.run(ops => ops.replaceExercise(3, SQUAT));

    expect(h.blocks()).toBe(before);
  });

  it('reports no index shift, because a replacement moves no row', () => {
    const h = setup([benchBlock()]);

    h.run(ops => ops.replaceExercise(0, INCLINE));

    // The block stays at its index and keeps its rows, so a stopwatch running
    // on it is still pointing at the row it was started on.
    expect(h.onBlockIndicesShifted).not.toHaveBeenCalled();
    expect(h.onSetIndicesShifted).not.toHaveBeenCalled();
    expect(h.onDropIndicesShifted).not.toHaveBeenCalled();
  });
});

describe('turning drop sets off', () => {
  it('clears every drop of the block and reports that they are all gone', () => {
    const h = setup([
      benchBlock({
        dropSetsEnabled: true,
        sets: [
          row({ setNumber: 1, drops: [drop({ weight: '100' }), drop({ weight: '90' })] }),
          row({ setNumber: 2, drops: [drop({ weight: '95' })] }),
          row({ setNumber: 3 }),
        ],
      }),
      benchBlock({ exerciseId: SQUAT, exerciseName: 'Back Squat', dropSetsEnabled: true, sets: [row({ drops: [drop({ weight: '185' })] })] }),
    ]);

    h.run(ops => ops.toggleDropSets(0));

    const block = h.blocks()[0];
    expect(block.dropSetsEnabled).toBe(false);
    expect(block.sets.map(s => s.drops)).toEqual([undefined, undefined, undefined]);
    // The other exercise keeps its drops.
    expect(h.blocks()[1].sets[0].drops).toHaveLength(1);

    expect(h.onDropIndicesShifted).toHaveBeenCalledTimes(1);
    const [blockIdx, setIdx, remap] = h.onDropIndicesShifted.mock.calls[0];
    expect(blockIdx).toBe(0);
    // `null` for the set index means "every set of this block".
    expect(setIdx).toBeNull();
    expect([0, 1, 2].map(remap)).toEqual([null, null, null]);
  });

  it('turning them back on adds no drops and reports nothing', () => {
    const h = setup([benchBlock({ dropSetsEnabled: false })]);

    h.run(ops => ops.toggleDropSets(0));

    expect(h.blocks()[0].dropSetsEnabled).toBe(true);
    expect(h.blocks()[0].sets.every(s => s.drops === undefined)).toBe(true);
    expect(h.onDropIndicesShifted).not.toHaveBeenCalled();
  });

  it('a block that was left undefined counts as off, so the first toggle turns it on', () => {
    const h = setup([benchBlock()]);
    expect(h.blocks()[0].dropSetsEnabled).toBeUndefined();

    h.run(ops => ops.toggleDropSets(0));

    expect(h.blocks()[0].dropSetsEnabled).toBe(true);
    expect(h.onDropIndicesShifted).not.toHaveBeenCalled();
  });
});

describe('adding warm-up sets', () => {
  it('prepends the warm-up and renumbers warm-ups and working sets separately', () => {
    const h = setup([benchBlock()]);

    h.run(ops => ops.addWarmupSet(0));

    const sets = h.blocks()[0].sets;
    expect(sets.map(s => s.type)).toEqual(['warmup', 'normal', 'normal', 'normal']);
    expect(sets.map(s => s.setNumber)).toEqual([1, 1, 2, 3]);
    expect(sets[0]).toMatchObject({ weight: '', reps: '', rpe: '', time: '', completed: false });

    h.run(ops => ops.addWarmupSet(0));
    const twice = h.blocks()[0].sets;
    expect(twice.map(s => s.type)).toEqual(['warmup', 'warmup', 'normal', 'normal', 'normal']);
    expect(twice.map(s => s.setNumber)).toEqual([1, 2, 1, 2, 3]);
  });

  it('pushes every row of that block down by one and reports it', () => {
    const h = setup([benchBlock(), benchBlock({ exerciseId: SQUAT, exerciseName: 'Back Squat' })]);

    h.run(ops => ops.addWarmupSet(1));

    expect(h.onSetIndicesShifted).toHaveBeenCalledTimes(1);
    const [blockIdx, remap] = h.onSetIndicesShifted.mock.calls[0];
    expect(blockIdx).toBe(1);
    expect([0, 1, 2].map(remap)).toEqual([1, 2, 3]);
    // The untouched block keeps its rows.
    expect(h.blocks()[0].sets).toHaveLength(3);
    expect(h.onBlockIndicesShifted).not.toHaveBeenCalled();
  });
});

describe('deleting a set, with the fiber already holding pending work', () => {
  it('removes the row, renumbers, and reports the rows below it moving up', () => {
    const h = setup([benchBlock({
      sets: [
        row({ setNumber: 1, weight: '135' }),
        row({ setNumber: 2, weight: '145' }),
        row({ setNumber: 3, weight: '155' }),
      ],
    })]);

    h.run(ops => ops.removeSet(0, 1));

    expect(h.blocks()[0].sets.map(s => s.weight)).toEqual(['135', '155']);
    expect(h.blocks()[0].sets.map(s => s.setNumber)).toEqual([1, 2]);
    const [blockIdx, remap] = h.onSetIndicesShifted.mock.calls[0];
    expect(blockIdx).toBe(0);
    expect([0, 1, 2].map(remap)).toEqual([0, null, 1]);
  });

  // The Undo action captures the deleted row from the render's `blocks`. Read
  // from inside the updater instead, it would be undefined here: React has not
  // run the updater by the time the toast is raised.
  it('Undo restores the row it deleted, not an empty one', () => {
    const h = setup([benchBlock({
      sets: [
        row({ setNumber: 1, weight: '135', reps: '10', rpe: '8', completed: true }),
        row({ setNumber: 2, weight: '145' }),
      ],
    })]);

    h.run(ops => ops.removeSet(0, 0));
    expect(h.blocks()[0].sets.map(s => s.weight)).toEqual(['145']);

    const undo = (toast as unknown as { mock: { calls: [string, { action: { onClick: () => void } }][] } }).mock.calls[0][1].action.onClick;
    act(() => {
      h.ops().markPendingWork();
      undo();
    });

    const sets = h.blocks()[0].sets;
    expect(sets).toHaveLength(2);
    expect(sets[0]).toMatchObject({ weight: '135', reps: '10', rpe: '8', completed: true, setNumber: 1 });
    expect(sets[1]).toMatchObject({ weight: '145', setNumber: 2 });

    const [, undoRemap] = h.onSetIndicesShifted.mock.calls[1];
    expect([0].map(undoRemap)).toEqual([1]);
  });

  it('does nothing for a row that is not there', () => {
    const h = setup([benchBlock()]);

    h.run(ops => ops.removeSet(0, 9));

    expect(h.blocks()[0].sets).toHaveLength(3);
    expect(h.onSetIndicesShifted).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('removing an exercise', () => {
  it('drops the block and pulls the later ones up', () => {
    const h = setup([
      benchBlock(),
      benchBlock({ exerciseId: SQUAT, exerciseName: 'Back Squat' }),
      benchBlock({ exerciseId: INCLINE, exerciseName: 'Incline Barbell Bench Press' }),
    ]);

    h.run(ops => ops.removeExercise(1));

    expect(h.blocks().map(b => b.exerciseId)).toEqual([BENCH, INCLINE]);
    const [remap] = h.onBlockIndicesShifted.mock.calls[0];
    expect([0, 1, 2].map(remap)).toEqual([0, null, 1]);
  });
});
