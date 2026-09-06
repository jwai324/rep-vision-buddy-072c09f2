import { describe, it, expect } from 'vitest';
import { carryTemplateOnlyFields } from '@/contexts/ChatContext';
import type { ExerciseInput } from '@/contexts/ChatContext';

const stored: ExerciseInput[] = [
  { exerciseId: 'a', sets: 3, targetReps: 10, setType: 'superset', restSeconds: 60, supersetGroup: 1, targetWeight: 60, targetRpe: 8 },
  { exerciseId: 'b', sets: 3, targetReps: 10, setType: 'superset', restSeconds: 60, supersetGroup: 1, targetWeight: 40 },
];

// What the coach can express: the tool schema's fields only.
const resent = (o: Partial<ExerciseInput> = {}): ExerciseInput => ({
  exerciseId: 'a', sets: 3, targetReps: 10, setType: 'superset', restSeconds: 60, ...o,
});

describe('carryTemplateOnlyFields', () => {
  it('keeps the superset link and the target load the model never saw', () => {
    const [carried] = carryTemplateOnlyFields([resent()], stored);
    expect(carried.supersetGroup).toBe(1);
    expect(carried.targetWeight).toBe(60);
    expect(carried.targetRpe).toBe(8);
  });

  it('lets the model change a link it does send', () => {
    const [carried] = carryTemplateOnlyFields([resent({ supersetGroup: 2, targetWeight: 70 })], stored);
    expect(carried.supersetGroup).toBe(2);
    expect(carried.targetWeight).toBe(70);
  });

  it('leaves an exercise the template never had untouched', () => {
    const [carried] = carryTemplateOnlyFields([resent({ exerciseId: 'z' })], stored);
    expect(carried.supersetGroup).toBeUndefined();
    expect(carried.targetWeight).toBeUndefined();
  });

  it('survives a template with no exercises to carry from', () => {
    expect(carryTemplateOnlyFields([resent()], undefined)[0].supersetGroup).toBeUndefined();
  });
});
