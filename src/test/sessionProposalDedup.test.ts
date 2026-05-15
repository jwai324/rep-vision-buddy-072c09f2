import { describe, it, expect } from 'vitest';
import { isDuplicateSessionAdd } from '@/contexts/ChatContext';
import type { Proposal } from '@/contexts/ChatContext';

type Candidate = Pick<Proposal, 'toolName' | 'arguments' | 'status'>;

const mkAdd = (exerciseId: string, status: Proposal['status'] = 'pending'): Candidate => ({
  toolName: 'add_exercise_to_workout',
  arguments: { exerciseId },
  status,
});

describe('isDuplicateSessionAdd', () => {
  it('first add for an exerciseId is not a duplicate (empty covered set)', () => {
    expect(isDuplicateSessionAdd(mkAdd('bench-press'), new Set())).toBe(false);
  });

  it('second add for an already-covered exerciseId is a duplicate', () => {
    expect(isDuplicateSessionAdd(mkAdd('bench-press'), new Set(['bench-press']))).toBe(true);
  });

  it('distinct exerciseId is never collapsed even when another is covered', () => {
    expect(isDuplicateSessionAdd(mkAdd('squat'), new Set(['bench-press']))).toBe(false);
  });

  it('non-add session tools are never treated as duplicates', () => {
    const p = { ...mkAdd('bench-press'), toolName: 'add_sets_to_exercise' as const };
    expect(isDuplicateSessionAdd(p, new Set(['bench-press']))).toBe(false);
  });

  it('an invalid-status proposal is never collapsed (rejected cards pass through)', () => {
    expect(isDuplicateSessionAdd(mkAdd('bench-press', 'invalid'), new Set(['bench-press']))).toBe(false);
  });

  it('missing exerciseId is not a duplicate', () => {
    const p: Candidate = { toolName: 'add_exercise_to_workout', arguments: {}, status: 'pending' };
    expect(isDuplicateSessionAdd(p, new Set(['bench-press']))).toBe(false);
  });
});

describe('batch dedup behavior (loop accumulation simulated)', () => {
  // Mirrors the tool-loop covered-set logic: covered starts empty (no
  // prior-response seeding), the first valid pending add seeds it, and any
  // subsequent identical add in the same response collapses to a notice.
  function runBatch(addExerciseIds: string[]) {
    const covered = new Set<string>();
    const pending: string[] = [];
    const notices: string[] = [];
    for (const exId of addExerciseIds) {
      const candidate = mkAdd(exId);
      if (isDuplicateSessionAdd(candidate, covered)) {
        notices.push(exId);
      } else {
        pending.push(exId);
        covered.add(exId);
      }
    }
    return { pending, notices };
  }

  it('two identical add_exercise calls -> exactly one pending tile + one notice', () => {
    const { pending, notices } = runBatch(['bench-press', 'bench-press']);
    expect(pending).toEqual(['bench-press']);
    expect(notices).toEqual(['bench-press']);
  });

  it('two distinct adds in one response -> two pending tiles, no notices', () => {
    const { pending, notices } = runBatch(['bench-press', 'squat']);
    expect(pending).toEqual(['bench-press', 'squat']);
    expect(notices).toEqual([]);
  });

  it('triple duplicate -> one pending, two notices', () => {
    const { pending, notices } = runBatch(['deadlift', 'deadlift', 'deadlift']);
    expect(pending).toEqual(['deadlift']);
    expect(notices.length).toBe(2);
  });
});
