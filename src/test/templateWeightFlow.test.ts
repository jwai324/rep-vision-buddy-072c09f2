import { describe, it, expect } from 'vitest';
import {
  snapshotFromTemplateExercises,
  snapshotFromFinishedBlocks,
  diffTemplateSnapshots,
  buildUpdatedTemplate,
  type FinishedBlockLite,
} from '@/utils/templateDiff';
import { targetWeightToInput, inputToTargetWeight } from '@/utils/weightConversion';
import type { WorkoutTemplate } from '@/types/workout';

/**
 * Walks the seam ActiveSession sits on: template target → prefilled set input →
 * what the lifter typed → finished block → diff → updated template → the next
 * session's prefill. Unit tests cover each hop; this catches the kg/display
 * conversions cancelling out wrongly across the whole loop.
 */
describe('template weight flow (lbs lifter)', () => {
  const template: WorkoutTemplate = {
    id: 't1',
    name: 'Push',
    exercises: [{
      exerciseId: 'flat-barbell-bench-press',
      sets: 3,
      targetReps: 10,
      setType: 'normal',
      restSeconds: 90,
      targetWeight: 61.23, // 135 lbs
    }],
  };

  const finishedWith = (weightInput: string): FinishedBlockLite[] => ([{
    exerciseId: 'flat-barbell-bench-press',
    completedSetCount: 3,
    lastReps: 10,
    lastWeight: inputToTargetWeight(weightInput, 'lbs', false),
    setType: 'normal',
    restSeconds: 90,
  }]);

  const diffAgainstTemplate = (finished: FinishedBlockLite[]) => diffTemplateSnapshots(
    snapshotFromTemplateExercises(template.exercises),
    snapshotFromFinishedBlocks(finished),
  );

  it('prefills the set at the stored target', () => {
    const prefill = targetWeightToInput(template.exercises[0].targetWeight, 'lbs', false);
    expect(Math.round(parseFloat(prefill))).toBe(135);
  });

  it('offers the update and stores the new load when the lifter goes heavier', () => {
    const finished = finishedWith('145');
    const diff = diffAgainstTemplate(finished);
    expect(diff.hasChanges).toBe(true);
    expect(diff.summary).toBe('1 weight change');

    const updated = buildUpdatedTemplate(template, finished);
    const nextPrefill = targetWeightToInput(updated.exercises[0].targetWeight, 'lbs', false);
    expect(Math.round(parseFloat(nextPrefill))).toBe(145);
  });

  it('stays quiet when the lifter just repeats the prefilled template', () => {
    // The regression this guards: kg storage + lbs display means the value
    // typed back is not bit-identical to the stored one, which would otherwise
    // pop the "Update template?" prompt after every single session.
    const prefill = targetWeightToInput(template.exercises[0].targetWeight, 'lbs', false);
    expect(diffAgainstTemplate(finishedWith(prefill)).hasChanges).toBe(false);
  });
});
