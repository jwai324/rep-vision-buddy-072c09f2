import { describe, it, expect } from 'vitest';
import { describeSupersetOrder, groupAdjacentSupersets, linkedSetType, resolveTemplateSupersets, withoutLoneSupersets } from '@/utils/templateSupersets';
import type { TemplateExercise } from '@/types/workout';
import { supersetInfo } from '@/types/activeSession';

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

describe('supersetInfo', () => {
  const at = (groups: (number | undefined)[]) => groups.map(g => ({ supersetGroup: g }));

  it('letters groups by where they appear, not by their stored id', () => {
    // Ids go sparse as supersets are made and unmade; the labels must not.
    const items = at([7, 7, undefined, 2, 2]);
    expect(supersetInfo(items, 0)?.letter).toBe('A');
    expect(supersetInfo(items, 3)?.letter).toBe('B');
    expect(supersetInfo(items, 2)).toBeNull();
  });

  it('reports where an exercise sits in its group and how big the group is', () => {
    const items = at([1, 1, 1, undefined]);
    expect(supersetInfo(items, 0)).toMatchObject({ position: 1, size: 3 });
    expect(supersetInfo(items, 2)).toMatchObject({ position: 3, size: 3 });
  });

  it('gives the same colour to the letter on every surface', () => {
    const a = supersetInfo(at([4, 4]), 0)!;
    const b = supersetInfo(at([9, 9]), 0)!;
    expect(a.letter).toBe(b.letter);
    expect(a.colorClass).toBe(b.colorClass);
  });

  it('counts members that are not adjacent', () => {
    expect(supersetInfo(at([1, undefined, 1]), 0)).toMatchObject({ position: 1, size: 2 });
  });
});

describe('describeSupersetOrder', () => {
  const name = (e: TemplateExercise) => e.exerciseId;

  it('joins a superset with + and everything else with an arrow', () => {
    const line = describeSupersetOrder(resolveTemplateSupersets([
      ex({ exerciseId: 'bench', setType: 'superset' }),
      ex({ exerciseId: 'row', setType: 'superset' }),
      ex({ exerciseId: 'plank' }),
    ]), name);
    expect(line).toBe('bench + row → plank');
  });

  it('brackets each pair of a long run separately', () => {
    const line = describeSupersetOrder(resolveTemplateSupersets(
      ['a', 'b', 'c', 'd'].map(id => ex({ exerciseId: id, setType: 'superset' })),
    ), name);
    expect(line).toBe('a + b → c + d');
  });

  it('reads a non-adjacent pair as one bracket, where it first appears', () => {
    const line = describeSupersetOrder([
      ex({ exerciseId: 'a', supersetGroup: 1 }),
      ex({ exerciseId: 'b' }),
      ex({ exerciseId: 'c', supersetGroup: 1 }),
    ], name);
    expect(line).toBe('a + c → b');
  });

  it('leaves a template with no supersets exactly as it read before', () => {
    const line = describeSupersetOrder(['a', 'b'].map(id => ex({ exerciseId: id })), name);
    expect(line).toBe('a → b');
  });
});
