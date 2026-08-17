import { describe, it, expect } from 'vitest';
import {
  buildExerciseLookup,
  buildProgramSnapshot,
  buildSessionSnapshot,
  buildTemplateSnapshot,
  isCustomExerciseId,
  remapProgram,
  remapTemplate,
  type CustomExerciseLite,
  type SnapshotContext,
} from '@/utils/shareSnapshot';
import { SHARE_SNAPSHOT_VERSION } from '@/types/share';
import type {
  TemplateExercise,
  WorkoutProgram,
  WorkoutSession,
  WorkoutTemplate,
} from '@/types/workout';

const CUSTOM_ID = 'custom-11111111-2222-3333-4444-555555555555';

const plank: CustomExerciseLite = {
  id: CUSTOM_ID,
  name: 'Weighted Plank',
  primaryBodyPart: 'Core',
  equipment: 'Bodyweight',
  difficulty: 'Intermediate',
  exerciseType: 'Compound',
  movementPattern: 'Core',
  secondaryMuscles: ['Shoulders'],
  measurementType: 'Time',
  isCustom: true,
  isRecovery: false,
};

const ctx = (over: Partial<SnapshotContext> = {}): SnapshotContext => ({
  weightUnit: 'lbs',
  sharedBy: 'Justin',
  customExercises: [plank],
  now: () => '2026-08-17T00:00:00.000Z',
  ...over,
});

const tplExercise = (over: Partial<TemplateExercise> = {}): TemplateExercise => ({
  exerciseId: 'flat-barbell-bench-press',
  sets: 3,
  targetReps: 10,
  setType: 'normal',
  restSeconds: 90,
  ...over,
});

const template = (over: Partial<WorkoutTemplate> = {}): WorkoutTemplate => ({
  id: 'tpl-push',
  name: 'Push Day',
  exercises: [tplExercise(), tplExercise({ exerciseId: CUSTOM_ID, targetWeight: 20 })],
  ...over,
});

describe('isCustomExerciseId', () => {
  it('recognises the custom-<uuid> id format and nothing else', () => {
    expect(isCustomExerciseId(CUSTOM_ID)).toBe(true);
    expect(isCustomExerciseId('flat-barbell-bench-press')).toBe(false);
  });
});

describe('buildExerciseLookup', () => {
  it('merges built-in exercises with custom ones', () => {
    const lookup = buildExerciseLookup([plank]);
    expect(lookup['flat-barbell-bench-press'].name).toBe('Flat Barbell Bench Press');
    expect(lookup[CUSTOM_ID].name).toBe('Weighted Plank');
  });
});

describe('buildTemplateSnapshot', () => {
  it('resolves every exercise id to a display name, custom ones included', () => {
    const snap = buildTemplateSnapshot(template(), ctx());
    const names = Object.fromEntries(snap.exerciseMeta.map(m => [m.exerciseId, m.name]));
    expect(names['flat-barbell-bench-press']).toBe('Flat Barbell Bench Press');
    expect(names[CUSTOM_ID]).toBe('Weighted Plank');
  });

  it('carries the custom exercise definition, including measurementType', () => {
    const snap = buildTemplateSnapshot(template(), ctx());
    expect(snap.customExercises).toHaveLength(1);
    expect(snap.customExercises[0]).toMatchObject({
      sourceId: CUSTOM_ID,
      name: 'Weighted Plank',
      measurementType: 'Time',
    });
  });

  it('does not carry custom exercises the template never references', () => {
    const unused: CustomExerciseLite = { ...plank, id: 'custom-unused', name: 'Sled Push' };
    const snap = buildTemplateSnapshot(template(), ctx({ customExercises: [plank, unused] }));
    expect(snap.customExercises.map(c => c.sourceId)).toEqual([CUSTOM_ID]);
  });

  it('falls back to the raw id when an exercise no longer resolves', () => {
    const snap = buildTemplateSnapshot(
      template({ exercises: [tplExercise({ exerciseId: 'custom-deleted' })] }),
      ctx(),
    );
    expect(snap.exerciseMeta[0].name).toBe('custom-deleted');
    expect(snap.customExercises).toEqual([]);
  });

  it('stamps the snapshot version', () => {
    expect(buildTemplateSnapshot(template(), ctx()).version).toBe(SHARE_SNAPSHOT_VERSION);
  });
});

describe('buildProgramSnapshot', () => {
  const push = template();
  const pull = template({ id: 'tpl-pull', name: 'Pull Day', exercises: [tplExercise({ exerciseId: 'barbell-row' })] });

  const program = (over: Partial<WorkoutProgram> = {}): WorkoutProgram => ({
    id: 'prog-1',
    name: 'PPL',
    days: [
      { label: 'Day 1', templateId: 'tpl-push' },
      { label: 'Day 2', templateId: 'tpl-pull' },
      { label: 'Day 3', templateId: 'rest' },
      { label: 'Day 4', templateId: 'tpl-push' },
    ],
    durationWeeks: 8,
    ...over,
  });

  it('embeds each referenced template exactly once and skips rest days', () => {
    const snap = buildProgramSnapshot(program(), [push, pull], ctx());
    expect(snap.templates.map(t => t.id)).toEqual(['tpl-push', 'tpl-pull']);
  });

  it('drops a dangling templateId without throwing, keeping the day itself', () => {
    const snap = buildProgramSnapshot(
      program({ days: [{ label: 'Day 1', templateId: 'tpl-deleted' }] }),
      [push, pull],
      ctx(),
    );
    expect(snap.templates).toEqual([]);
    expect(snap.program.days).toHaveLength(1);
  });

  it('collects custom exercises used by any embedded template', () => {
    const snap = buildProgramSnapshot(program(), [push, pull], ctx());
    expect(snap.customExercises.map(c => c.sourceId)).toEqual([CUSTOM_ID]);
  });
});

describe('buildSessionSnapshot', () => {
  const session: WorkoutSession = {
    id: 'sess-1',
    date: '2026-08-16',
    exercises: [
      { exerciseId: CUSTOM_ID, exerciseName: 'Weighted Plank', sets: [{ setNumber: 1, type: 'normal', reps: 1, time: 60 }] },
    ],
    duration: 3600,
    totalVolume: 1234.5,
    totalSets: 1,
    totalReps: 1,
    location: 'Home Gym',
    note: 'felt strong',
  };

  it('omits location so a link never publishes where the sharer trains', () => {
    const snap = buildSessionSnapshot(session, ctx());
    expect(snap.session).not.toHaveProperty('location');
    expect(snap.session.note).toBe('felt strong');
  });

  it('keeps totalVolume a number so the kg formatter is not handed a string', () => {
    const snap = buildSessionSnapshot(session, ctx());
    expect(typeof snap.session.totalVolume).toBe('number');
    expect(snap.session.totalVolume).toBe(1234.5);
  });

  it('carries custom exercise definitions so the session can be saved as a template', () => {
    expect(buildSessionSnapshot(session, ctx()).customExercises.map(c => c.sourceId)).toEqual([CUSTOM_ID]);
  });
});

describe('share → import round trip', () => {
  it('remaps custom exercise ids and mints a fresh template id, leaving loads untouched', () => {
    const snap = buildTemplateSnapshot(template(), ctx());
    const copy = remapTemplate(snap.template, { [CUSTOM_ID]: 'custom-recipient-row' });

    expect(copy.id).not.toBe('tpl-push');
    expect(copy.exercises.map(e => e.exerciseId)).toEqual([
      'flat-barbell-bench-press',       // built-in ids pass through
      'custom-recipient-row',
    ]);
    // targetWeight is canonical kg on both sides — sharing must not convert it.
    expect(copy.exercises[1].targetWeight).toBe(20);
  });

  it('remaps every program day templateId and leaves rest days alone', () => {
    const program: WorkoutProgram = {
      id: 'prog-1',
      name: 'PPL',
      days: [
        { label: 'Day 1', templateId: 'tpl-push' },
        { label: 'Day 2', templateId: 'rest' },
        { label: 'Day 3', templateId: 'tpl-pull' },
      ],
    };
    const copy = remapProgram(program, { 'tpl-push': 'new-push', 'tpl-pull': 'new-pull' });

    expect(copy.id).not.toBe('prog-1');
    expect(copy.days.map(d => d.templateId)).toEqual(['new-push', 'rest', 'new-pull']);
  });

  it('gives two imports of the same snapshot different ids', () => {
    const snap = buildTemplateSnapshot(template(), ctx());
    expect(remapTemplate(snap.template, {}).id).not.toBe(remapTemplate(snap.template, {}).id);
  });
});

describe('snapshot privacy', () => {
  it('never carries a user_id', () => {
    const snaps = [
      buildTemplateSnapshot(template(), ctx()),
      buildProgramSnapshot({ id: 'p', name: 'P', days: [] }, [], ctx()),
    ];
    for (const snap of snaps) {
      expect(JSON.stringify(snap)).not.toContain('user_id');
    }
  });
});
