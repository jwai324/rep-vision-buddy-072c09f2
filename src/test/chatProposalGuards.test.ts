import { describe, it, expect } from 'vitest';
import {
  normalizeSetType, templateExerciseIssues, sessionArgIssues, remapSupersetGroups,
  templateChangedSince, templateDeleteBlockers, unknownProgramTemplates,
} from '@/contexts/ChatContext';
import type { ExerciseInput } from '@/contexts/ChatContext';
import { formatLocalDate } from '@/utils/dateUtils';

const ex = (o: Partial<ExerciseInput> & { exerciseId: string }): ExerciseInput =>
  ({ sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90, ...o });

describe('normalizeSetType', () => {
  it('keeps every SetType the app knows', () => {
    for (const t of ['normal', 'superset', 'dropset', 'failure', 'warmup']) expect(normalizeSetType(t)).toBe(t);
  });

  it('turns anything else into normal instead of crashing the summary later', () => {
    expect(normalizeSetType('giant')).toBe('normal');
    expect(normalizeSetType('')).toBe('normal');
    expect(normalizeSetType(undefined)).toBe('normal');
    expect(normalizeSetType(3)).toBe('normal');
  });
});

describe('templateExerciseIssues', () => {
  it('accepts an ordinary row and a set taken to failure', () => {
    expect(templateExerciseIssues(ex({ exerciseId: 'a' }), 'A')).toEqual([]);
    expect(templateExerciseIssues(ex({ exerciseId: 'a', targetReps: 'failure', targetWeight: 62.5 }), 'A')).toEqual([]);
  });

  it('refuses zero, negative, fractional and absurd set counts', () => {
    for (const sets of [0, -1, 2.5, 10_000_000]) {
      expect(templateExerciseIssues(ex({ exerciseId: 'a', sets }), 'A')[0]).toMatch(/sets must be a whole number from 1 to 20/);
    }
  });

  it('refuses a missing sets or targetReps rather than saving a template that cannot start', () => {
    expect(templateExerciseIssues({ exerciseId: 'a', setType: 'normal' }, 'A')).toHaveLength(2);
  });

  it('refuses bad reps, rest and load, naming the exercise', () => {
    const issues = templateExerciseIssues(ex({ exerciseId: 'a', targetReps: 0, restSeconds: -30, targetWeight: -5 }), 'Bench');
    expect(issues).toHaveLength(3);
    for (const i of issues) expect(i).toMatch(/^Bench: /);
  });
});

describe('sessionArgIssues', () => {
  it('lets every field be omitted', () => {
    expect(sessionArgIssues({})).toEqual([]);
  });

  it('bounds the array lengths and rejects negative load', () => {
    expect(sessionArgIssues({ sets: 0 })).toHaveLength(1);
    expect(sessionArgIssues({ count: 1.5 })).toHaveLength(1);
    expect(sessionArgIssues({ weight: -10 })).toHaveLength(1);
    expect(sessionArgIssues({ reps: 12, weight: 60, sets: 3, count: 2, targetReps: 8 })).toEqual([]);
  });
});

describe('remapSupersetGroups', () => {
  const existing = [ex({ exerciseId: 'a', supersetGroup: 1 }), ex({ exerciseId: 'b', supersetGroup: 1 }), ex({ exerciseId: 'c' })];

  it('gives a new pair that collides with an existing group a fresh id', () => {
    const out = remapSupersetGroups(existing, [ex({ exerciseId: 'd', supersetGroup: 1 }), ex({ exerciseId: 'e', supersetGroup: 1 })]);
    expect(out.map(e => e.supersetGroup)).toEqual([2, 2]);
  });

  it('keeps a non-colliding group and an unlinked exercise as sent', () => {
    const out = remapSupersetGroups(existing, [ex({ exerciseId: 'd', supersetGroup: 5 }), ex({ exerciseId: 'e', supersetGroup: 5 }), ex({ exerciseId: 'f' })]);
    expect(out.map(e => e.supersetGroup)).toEqual([5, 5, undefined]);
  });

  it('never hands a colliding pair the id a non-colliding incoming pair already carries', () => {
    // Template holds group 1; the model numbers its two new pairs 1 and 2.
    // The fresh id for the colliding pair used to be 2, fusing it with the
    // second pair into one four-exercise superset.
    const out = remapSupersetGroups(existing, [
      ex({ exerciseId: 'd', supersetGroup: 1 }), ex({ exerciseId: 'e', supersetGroup: 1 }),
      ex({ exerciseId: 'f', supersetGroup: 2 }), ex({ exerciseId: 'g', supersetGroup: 2 }),
    ]);
    const groups = out.map(e => e.supersetGroup);
    expect(groups[0]).toBe(groups[1]);
    expect(groups[2]).toBe(groups[3]);
    expect(groups[0]).not.toBe(groups[2]);
    expect(groups).not.toContain(1);
  });

  it('lets a single addition join an existing superset', () => {
    const out = remapSupersetGroups(existing, [ex({ exerciseId: 'd', supersetGroup: 1 })]);
    expect(out[0].supersetGroup).toBe(1);
  });

  it('keeps two colliding pairs apart from each other', () => {
    const out = remapSupersetGroups(
      [...existing, ex({ exerciseId: 'x', supersetGroup: 2 }), ex({ exerciseId: 'y', supersetGroup: 2 })],
      [ex({ exerciseId: 'd', supersetGroup: 1 }), ex({ exerciseId: 'e', supersetGroup: 1 }), ex({ exerciseId: 'f', supersetGroup: 2 }), ex({ exerciseId: 'g', supersetGroup: 2 })],
    );
    expect(out.map(e => e.supersetGroup)).toEqual([3, 3, 4, 4]);
  });
});

describe('templateChangedSince', () => {
  const before = { name: 'Push', exercises: [ex({ exerciseId: 'a', targetWeight: 60 }), ex({ exerciseId: 'b' })] };

  it('is false for a reloaded copy with the same content', () => {
    const reloaded = { name: 'Push', exercises: [{ exerciseId: 'a', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90, targetWeight: 60, targetRpe: undefined }, ex({ exerciseId: 'b' })] };
    expect(templateChangedSince(before, reloaded)).toBe(false);
  });

  it('is true when a set count, the name, the order or the list changed, or the template is gone', () => {
    expect(templateChangedSince(before, { name: 'Push', exercises: [ex({ exerciseId: 'a', targetWeight: 60, sets: 4 }), ex({ exerciseId: 'b' })] })).toBe(true);
    expect(templateChangedSince(before, { ...before, name: 'Push B' })).toBe(true);
    expect(templateChangedSince(before, { name: 'Push', exercises: [ex({ exerciseId: 'b' }), ex({ exerciseId: 'a', targetWeight: 60 })] })).toBe(true);
    expect(templateChangedSince(before, { name: 'Push', exercises: [ex({ exerciseId: 'a', targetWeight: 60 })] })).toBe(true);
    expect(templateChangedSince(before, undefined)).toBe(true);
  });
});

describe('templateDeleteBlockers', () => {
  const programs = [{ id: 'p1', name: 'PPL', days: [{ templateId: 't1' }, { templateId: 'rest' }] }];

  it('names the program that schedules the template', () => {
    expect(templateDeleteBlockers('t1', { programs, futureWorkouts: [], dataTrusted: true })).toEqual(['PPL']);
  });

  it('counts upcoming scheduled workouts no listed program accounts for', () => {
    const today = formatLocalDate();
    const futureWorkouts = [
      { templateId: 't2', programId: 'manual', date: today },
      { templateId: 't2', programId: 'manual', date: '2000-01-01' },
      { templateId: 't2', programId: 'manual', date: today, completed: true },
    ];
    expect(templateDeleteBlockers('t2', { programs, futureWorkouts, dataTrusted: true })).toEqual(['1 scheduled workout']);
  });

  it('is empty for an unreferenced template, and refuses while the data is untrusted', () => {
    expect(templateDeleteBlockers('t3', { programs, futureWorkouts: [], dataTrusted: true })).toEqual([]);
    expect(templateDeleteBlockers('t3', { programs, futureWorkouts: [], dataTrusted: false })).toEqual(['data that is still loading']);
  });
});

describe('unknownProgramTemplates', () => {
  const known = new Set(['t1']);

  it('accepts known ids and rest days', () => {
    expect(unknownProgramTemplates([{ templateId: 't1' }, { templateId: 'rest' }], known)).toEqual([]);
  });

  it('names each missing id once and flags a day with no id at all', () => {
    expect(unknownProgramTemplates([{ templateId: 'ghost' }, { templateId: 'ghost' }, { label: 'Day 3' }], known)).toEqual(['ghost', 'undefined']);
  });
});

describe('templateExerciseIssues — targetDistance', () => {
  it('accepts a distance in metres and an omitted one', () => {
    expect(templateExerciseIssues(ex({ exerciseId: 'a', targetDistance: 5000 }), 'Run')).toEqual([]);
    expect(templateExerciseIssues(ex({ exerciseId: 'a', targetDistance: undefined }), 'Run')).toEqual([]);
  });

  it('refuses zero, negative, non-finite and absurd distances, naming the exercise', () => {
    for (const bad of [0, -100, NaN, Infinity, 2_000_000]) {
      const issues = templateExerciseIssues(ex({ exerciseId: 'a', targetDistance: bad }), 'Run');
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/^Run: targetDistance/);
    }
  });
});

describe('templateChangedSince — targetDistance', () => {
  it('treats a changed distance target as a change', () => {
    const before = { name: 'Run', exercises: [ex({ exerciseId: 'r', targetDistance: 5000 })] };
    expect(templateChangedSince(before, { name: 'Run', exercises: [ex({ exerciseId: 'r', targetDistance: 5000 })] })).toBe(false);
    expect(templateChangedSince(before, { name: 'Run', exercises: [ex({ exerciseId: 'r', targetDistance: 8000 })] })).toBe(true);
  });
});
