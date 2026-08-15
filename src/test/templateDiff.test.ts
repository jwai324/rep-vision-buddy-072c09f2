import { describe, it, expect } from 'vitest';
import {
  snapshotFromTemplateExercises,
  snapshotFromFinishedBlocks,
  diffTemplateSnapshots,
  buildUpdatedTemplate,
  type FinishedBlockLite,
} from '@/utils/templateDiff';
import type { TemplateExercise, WorkoutTemplate } from '@/types/workout';

const ex = (over: Partial<TemplateExercise> = {}): TemplateExercise => ({
  exerciseId: 'bench-press',
  sets: 3,
  targetReps: 10,
  setType: 'normal',
  restSeconds: 90,
  ...over,
});

const finished = (over: Partial<FinishedBlockLite> = {}): FinishedBlockLite => ({
  exerciseId: 'bench-press',
  completedSetCount: 3,
  lastReps: 10,
  setType: 'normal',
  restSeconds: 90,
  ...over,
});

describe('templateDiff — unaltered workout must NOT trigger a prompt', () => {
  it('reports no changes when the user completes the template exactly', () => {
    const before = snapshotFromTemplateExercises([ex()]);
    const after = snapshotFromFinishedBlocks([finished()]);
    const diff = diffTemplateSnapshots(before, after);
    expect(diff.hasChanges).toBe(false);
  });

  it('reports no changes for a template that uses a superset group', () => {
    const before = snapshotFromTemplateExercises([
      ex({ exerciseId: 'bench-press', supersetGroup: 1 }),
      ex({ exerciseId: 'row', supersetGroup: 1 }),
    ]);
    const after = snapshotFromFinishedBlocks([
      finished({ exerciseId: 'bench-press', supersetGroup: 1 }),
      finished({ exerciseId: 'row', supersetGroup: 1 }),
    ]);
    const diff = diffTemplateSnapshots(before, after);
    expect(diff.hasChanges).toBe(false);
  });
});

describe('templateDiff — supersetGroup on the template must survive the snapshot', () => {
  it('carries the template exercise supersetGroup through when no override blocks are passed', () => {
    const before = snapshotFromTemplateExercises([
      ex({ exerciseId: 'bench-press', supersetGroup: 2 }),
    ]);
    expect(before[0].supersetGroup).toBe(2);
  });
});

describe('templateDiff — altered workouts SHOULD trigger a prompt', () => {
  it('detects an added set', () => {
    const before = snapshotFromTemplateExercises([ex()]);
    const after = snapshotFromFinishedBlocks([finished({ completedSetCount: 4 })]);
    expect(diffTemplateSnapshots(before, after).hasChanges).toBe(true);
  });

  it('detects a rep target change (on the last set)', () => {
    const before = snapshotFromTemplateExercises([ex()]);
    const after = snapshotFromFinishedBlocks([finished({ lastReps: 12 })]);
    expect(diffTemplateSnapshots(before, after).hasChanges).toBe(true);
  });

  it('detects an added exercise', () => {
    const before = snapshotFromTemplateExercises([ex()]);
    const after = snapshotFromFinishedBlocks([
      finished(),
      finished({ exerciseId: 'squat' }),
    ]);
    expect(diffTemplateSnapshots(before, after).hasChanges).toBe(true);
  });

  it('detects a removed exercise', () => {
    const before = snapshotFromTemplateExercises([ex(), ex({ exerciseId: 'squat' })]);
    const after = snapshotFromFinishedBlocks([finished()]);
    expect(diffTemplateSnapshots(before, after).hasChanges).toBe(true);
  });
});

describe('templateDiff — target weight', () => {
  it('reports no changes when the logged load matches the target', () => {
    const before = snapshotFromTemplateExercises([ex({ targetWeight: 60 })]);
    const after = snapshotFromFinishedBlocks([finished({ lastWeight: 60 })]);
    expect(diffTemplateSnapshots(before, after).hasChanges).toBe(false);
  });

  it('detects a heavier working set', () => {
    const before = snapshotFromTemplateExercises([ex({ targetWeight: 60 })]);
    const after = snapshotFromFinishedBlocks([finished({ lastWeight: 65 })]);
    const diff = diffTemplateSnapshots(before, after);
    expect(diff.hasChanges).toBe(true);
    expect(diff.targetWeightChanged).toBe(1);
    expect(diff.summary).toContain('1 weight change');
  });

  it('detects a load on a template that had no weight target yet', () => {
    const before = snapshotFromTemplateExercises([ex()]);
    const after = snapshotFromFinishedBlocks([finished({ lastWeight: 60 })]);
    expect(diffTemplateSnapshots(before, after).targetWeightChanged).toBe(1);
  });

  it('ignores lbs round-trip drift', () => {
    // 135 lbs → kg → lbs comes back a hair off; that is not an edit.
    const before = snapshotFromTemplateExercises([ex({ targetWeight: 61.23 })]);
    const after = snapshotFromFinishedBlocks([finished({ lastWeight: 61.235 })]);
    expect(diffTemplateSnapshots(before, after).hasChanges).toBe(false);
  });

  it('does not flag bodyweight work, where no load is ever logged', () => {
    const before = snapshotFromTemplateExercises([ex({ exerciseId: 'push-up' })]);
    const after = snapshotFromFinishedBlocks([finished({ exerciseId: 'push-up', lastWeight: undefined })]);
    expect(diffTemplateSnapshots(before, after).hasChanges).toBe(false);
  });

  it('does not wipe an existing target when a set is logged without a load', () => {
    const before = snapshotFromTemplateExercises([ex({ targetWeight: 60 })]);
    const after = snapshotFromFinishedBlocks([finished({ lastWeight: null })]);
    expect(diffTemplateSnapshots(before, after).hasChanges).toBe(false);
  });
});

describe('buildUpdatedTemplate', () => {
  it('preserves rest seconds from the original template', () => {
    const template: WorkoutTemplate = {
      id: 't1',
      name: 'Push',
      exercises: [ex({ restSeconds: 120 })],
    };
    const updated = buildUpdatedTemplate(template, [finished({ completedSetCount: 4 })]);
    expect(updated.exercises[0].sets).toBe(4);
    expect(updated.exercises[0].restSeconds).toBe(120);
  });

  it('writes the logged load into the template', () => {
    const template: WorkoutTemplate = { id: 't1', name: 'Push', exercises: [ex({ targetWeight: 60 })] };
    const updated = buildUpdatedTemplate(template, [finished({ lastWeight: 65 })]);
    expect(updated.exercises[0].targetWeight).toBe(65);
  });

  it('keeps the existing target when nothing was logged', () => {
    const template: WorkoutTemplate = { id: 't1', name: 'Push', exercises: [ex({ targetWeight: 60 })] };
    const updated = buildUpdatedTemplate(template, [finished({ lastWeight: null })]);
    expect(updated.exercises[0].targetWeight).toBe(60);
  });

  it('carries the RPE target across instead of dropping it', () => {
    const template: WorkoutTemplate = { id: 't1', name: 'Push', exercises: [ex({ targetRpe: 8 })] };
    const updated = buildUpdatedTemplate(template, [finished({ completedSetCount: 4 })]);
    expect(updated.exercises[0].targetRpe).toBe(8);
  });
});
