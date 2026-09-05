import { describe, it, expect } from 'vitest';
import { groupAdjacentSupersets, linkedSetType, resolveTemplateSupersets, withoutLoneSupersets } from '@/utils/templateSupersets';
import type { TemplateExercise } from '@/types/workout';

function ex(overrides: Partial<TemplateExercise> = {}): TemplateExercise {
  return {
    exerciseId: 'flat-barbell-bench-press',
    sets: 3,
    targetReps: 10,
    setType: 'normal',
    restSeconds: 90,
    ...overrides,
  };
}

describe('resolveTemplateSupersets', () => {
  it('returns the same array when every link is already explicit', () => {
    const exercises = [
      ex({ exerciseId: 'a', setType: 'superset', supersetGroup: 1 }),
      ex({ exerciseId: 'b', setType: 'superset', supersetGroup: 1 }),
      ex({ exerciseId: 'c' }),
    ];
    expect(resolveTemplateSupersets(exercises)).toBe(exercises);
  });

  it('links a run of superset-typed exercises that carry no group', () => {
    const resolved = resolveTemplateSupersets([
      ex({ exerciseId: 'a', setType: 'superset' }),
      ex({ exerciseId: 'b', setType: 'superset' }),
      ex({ exerciseId: 'c' }),
    ]);
    expect(resolved.map(e => e.supersetGroup)).toEqual([1, 1, undefined]);
    expect(resolved.map(e => e.setType)).toEqual(['superset', 'superset', 'normal']);
  });

  it('gives each separate run its own group', () => {
    const resolved = resolveTemplateSupersets([
      ex({ exerciseId: 'a', setType: 'superset' }),
      ex({ exerciseId: 'b', setType: 'superset' }),
      ex({ exerciseId: 'c' }),
      ex({ exerciseId: 'd', setType: 'superset' }),
      ex({ exerciseId: 'e', setType: 'superset' }),
      ex({ exerciseId: 'f', setType: 'superset' }),
    ]);
    expect(resolved.map(e => e.supersetGroup)).toEqual([1, 1, undefined, 2, 2, 2]);
  });

  it('numbers inferred groups above the ones the template already has', () => {
    const resolved = resolveTemplateSupersets([
      ex({ exerciseId: 'a', supersetGroup: 3 }),
      ex({ exerciseId: 'b', supersetGroup: 3 }),
      ex({ exerciseId: 'c', setType: 'superset' }),
      ex({ exerciseId: 'd', setType: 'superset' }),
    ]);
    expect(resolved.map(e => e.supersetGroup)).toEqual([3, 3, 4, 4]);
  });

  it('turns a lone superset-typed exercise back into a plain one', () => {
    const resolved = resolveTemplateSupersets([
      ex({ exerciseId: 'a', setType: 'superset' }),
      ex({ exerciseId: 'b' }),
    ]);
    expect(resolved[0].supersetGroup).toBeUndefined();
    expect(resolved[0].setType).toBe('normal');
  });

  it('does not bridge a run across exercises that are already grouped', () => {
    const resolved = resolveTemplateSupersets([
      ex({ exerciseId: 'a', setType: 'superset' }),
      ex({ exerciseId: 'b', supersetGroup: 1 }),
      ex({ exerciseId: 'c', supersetGroup: 1 }),
      ex({ exerciseId: 'd', setType: 'superset' }),
    ]);
    expect(resolved.map(e => e.supersetGroup)).toEqual([undefined, 1, 1, undefined]);
  });

  it('cuts a long run into pairs rather than one block of one colour', () => {
    // The shape the AI coach and the program generator write for "pair these
    // up": six in a row, no group ids. One group of six is not a superset.
    const resolved = resolveTemplateSupersets(
      ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ex({ exerciseId: id, setType: 'superset' })),
    );
    expect(resolved.map(e => e.supersetGroup)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it('ends an odd run in a trio rather than stranding the last one', () => {
    const resolved = resolveTemplateSupersets(
      ['a', 'b', 'c', 'd', 'e'].map(id => ex({ exerciseId: id, setType: 'superset' })),
    );
    expect(resolved.map(e => e.supersetGroup)).toEqual([1, 1, 2, 2, 2]);
    expect(resolved.every(e => e.setType === 'superset')).toBe(true);
  });

  it('clears a group only one exercise is left holding', () => {
    const resolved = resolveTemplateSupersets([
      ex({ exerciseId: 'a', setType: 'superset', supersetGroup: 2 }),
      ex({ exerciseId: 'b' }),
    ]);
    expect(resolved[0].supersetGroup).toBeUndefined();
    expect(resolved[0].setType).toBe('normal');
  });

  it('makes a linked exercise report the superset set type', () => {
    const resolved = resolveTemplateSupersets([
      ex({ exerciseId: 'a', supersetGroup: 1 }),
      ex({ exerciseId: 'b', supersetGroup: 1, setType: 'failure' }),
    ]);
    expect(resolved.map(e => e.setType)).toEqual(['superset', 'failure']);
  });
});

describe('linkedSetType', () => {
  it('echoes a link on a plain exercise and nowhere else', () => {
    expect(linkedSetType('normal', true)).toBe('superset');
    expect(linkedSetType('superset', true)).toBe('superset');
    expect(linkedSetType('failure', true)).toBe('failure');
    expect(linkedSetType('dropset', true)).toBe('dropset');
  });

  it('drops the echo once the link is gone', () => {
    expect(linkedSetType('superset', false)).toBe('normal');
    expect(linkedSetType('normal', false)).toBe('normal');
    expect(linkedSetType('failure', false)).toBe('failure');
  });
});

describe('withoutLoneSupersets', () => {
  it('keeps a real pair and drops a group of one', () => {
    const cleared = withoutLoneSupersets([
      ex({ exerciseId: 'a', setType: 'superset', supersetGroup: 1 }),
      ex({ exerciseId: 'b', setType: 'superset', supersetGroup: 1 }),
      ex({ exerciseId: 'c', setType: 'superset', supersetGroup: 2 }),
    ]);
    expect(cleared.map(e => e.supersetGroup)).toEqual([1, 1, undefined]);
    expect(cleared.map(e => e.setType)).toEqual(['superset', 'superset', 'normal']);
  });

  it('hands back the same array when every group has partners', () => {
    const exercises = [
      ex({ exerciseId: 'a', supersetGroup: 1 }),
      ex({ exerciseId: 'b', supersetGroup: 1 }),
    ];
    expect(withoutLoneSupersets(exercises)).toBe(exercises);
  });
});

describe('groupAdjacentSupersets', () => {
  it('pulls a partner up to its group without disturbing anything else', () => {
    const ordered = groupAdjacentSupersets([
      ex({ exerciseId: 'a', supersetGroup: 1 }),
      ex({ exerciseId: 'b' }),
      ex({ exerciseId: 'c', supersetGroup: 1 }),
      ex({ exerciseId: 'd' }),
    ]);
    expect(ordered.map(e => e.exerciseId)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('anchors each group where it first appears', () => {
    const ordered = groupAdjacentSupersets([
      ex({ exerciseId: 'a', supersetGroup: 2 }),
      ex({ exerciseId: 'b', supersetGroup: 1 }),
      ex({ exerciseId: 'c', supersetGroup: 2 }),
      ex({ exerciseId: 'd', supersetGroup: 1 }),
    ]);
    expect(ordered.map(e => e.exerciseId)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('hands back the same array when every group is already contiguous', () => {
    const exercises = [
      ex({ exerciseId: 'a', supersetGroup: 1 }),
      ex({ exerciseId: 'b', supersetGroup: 1 }),
      ex({ exerciseId: 'c' }),
    ];
    expect(groupAdjacentSupersets(exercises)).toBe(exercises);
  });
});
