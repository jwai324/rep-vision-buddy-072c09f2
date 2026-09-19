import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { importSharedSnapshot } from '@/utils/shareImport';
import {
  SHARE_SNAPSHOT_VERSION,
  type ProgramSnapshot,
  type SessionSnapshot,
  type SharedCustomExercise,
  type TemplateSnapshot,
} from '@/types/share';
import type { TemplateExercise, WorkoutTemplate } from '@/types/workout';

/**
 * Just enough of the client for `importSharedSnapshot`: the viewer owns only
 * the custom exercises given (none by default), and every insert echoes its
 * rows back with ids.
 *
 * The insert models the one PostgREST rule the real client trips over: the
 * `columns=` param is the union of every row's keys, undefined-valued ones
 * included, and a listed column a row's body does not carry is written NULL.
 * The fake cannot know which columns are NOT NULL, so it refuses every such
 * row — a value of `undefined`, or a key another row in the batch has — the
 * way the table refused a stub custom exercise.
 */
function fakeSupabase(existing: { id: string; name: string }[] = []) {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const client = {
    from: (table: string) => ({
      select: () => ({ eq: () => Promise.resolve({ data: table === 'custom_exercises' ? existing : [], error: null }) }),
      insert: (rows: unknown) => {
        const list = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
        const columns = Array.from(new Set(list.flatMap(row => Object.keys(row))));
        const nulled = columns.find(column => list.some(row => row[column] === undefined));
        const result = nulled
          ? {
            data: null,
            error: { code: '23502', message: `null value in column "${nulled}" of relation "${table}" violates not-null constraint` },
          }
          : { data: list.map((row, i) => ({ id: `row-${i}`, name: row.name })), error: null };
        if (!result.error) (inserted[table] ??= []).push(...list);
        return Object.assign(Promise.resolve(result), { select: () => Promise.resolve(result) });
      },
    }),
  };
  return { client: client as unknown as SupabaseClient, inserted };
}

const shared = (over: Partial<SharedCustomExercise> = {}): SharedCustomExercise => ({
  sourceId: 'custom-sharer-row',
  name: 'Banded Clamshell',
  primaryBodyPart: 'Glutes',
  equipment: 'Band',
  difficulty: 'Beginner',
  exerciseType: 'Isolation',
  movementPattern: 'Hip',
  secondaryMuscles: [],
  isRecovery: false,
  measurementType: null,
  ...over,
});

const snapshot = (ce: SharedCustomExercise): TemplateSnapshot => ({
  version: SHARE_SNAPSHOT_VERSION,
  sharedAt: '2026-08-17T00:00:00.000Z',
  weightUnit: 'kg',
  sharedBy: null,
  customExercises: [ce],
  kind: 'template',
  template: {
    id: 'tpl-rehab',
    name: 'Rehab',
    exercises: [{ exerciseId: ce.sourceId, sets: 3, targetReps: 15, setType: 'normal', restSeconds: 60 }],
  },
  exerciseMeta: [{ exerciseId: ce.sourceId, name: ce.name, icon: '🏋️' }],
});

describe('importSharedSnapshot — custom exercise flags', () => {
  it("carries exclude_from_volume onto the recipient's copy", async () => {
    const { client, inserted } = fakeSupabase();
    const result = await importSharedSnapshot(client, 'user-1', snapshot(shared({ excludeFromVolume: true })), 'Rehab');

    expect(result.customExercisesCreated).toBe(1);
    expect(inserted.custom_exercises[0]).toMatchObject({
      user_id: 'user-1',
      name: 'Banded Clamshell',
      exclude_from_volume: true,
    });
    // The template points at the recipient's new row, not the sharer's id.
    const template = inserted.workout_templates[0] as { exercises: { exerciseId: string }[] };
    expect(template.exercises[0].exerciseId).toBe('custom-row-0');
  });

  it('reads a payload written before the flag travelled as counting toward volume', async () => {
    const { client, inserted } = fakeSupabase();
    await importSharedSnapshot(client, 'user-1', snapshot(shared()), 'Rehab');
    expect(inserted.custom_exercises[0]).toMatchObject({ exclude_from_volume: false });
  });
});

const templateExercise = (exerciseId: string, over: Partial<TemplateExercise> = {}): TemplateExercise => ({
  exerciseId, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 60, ...over,
});

const templateSnapshot = (
  template: WorkoutTemplate,
  exerciseMeta: TemplateSnapshot['exerciseMeta'],
  customExercises: SharedCustomExercise[] = [],
): TemplateSnapshot => ({
  version: SHARE_SNAPSHOT_VERSION,
  sharedAt: '2026-09-19T00:00:00.000Z',
  weightUnit: 'kg',
  sharedBy: null,
  customExercises,
  kind: 'template',
  template,
  exerciseMeta,
});

const insertedTemplates = (inserted: Record<string, Record<string, unknown>[]>) =>
  (inserted.workout_templates ?? []) as unknown as WorkoutTemplate[];

describe('importSharedSnapshot — custom ids the snapshot uses but does not define', () => {
  const GHOST = 'custom-not-in-payload';
  const BENCH = 'flat-barbell-bench-press';

  it('creates a stub for an id the snapshot names, and points the template at it', async () => {
    const { client, inserted } = fakeSupabase();
    const snap = templateSnapshot(
      { id: 'tpl', name: 'Push', exercises: [templateExercise(BENCH), templateExercise(GHOST)] },
      [{ exerciseId: BENCH, name: 'Flat Barbell Bench Press', icon: '💪' }, { exerciseId: GHOST, name: 'Sled Push', icon: '🏋️' }],
    );
    const result = await importSharedSnapshot(client, 'user-1', snap, 'Push');

    expect(result).toMatchObject({ customExercisesCreated: 1, exercisesDropped: 0 });
    expect(inserted.custom_exercises).toHaveLength(1);
    // The stub has no metadata, so the row is written with the table's own
    // defaults — spelled out, never left undefined (see reconcileCustomExercises).
    expect(inserted.custom_exercises[0]).toEqual({
      user_id: 'user-1',
      name: 'Sled Push',
      primary_body_part: 'Full Body',
      equipment: 'None',
      difficulty: 'Intermediate',
      exercise_type: 'Isolation',
      movement_pattern: 'Other',
      secondary_muscles: [],
      is_recovery: false,
      measurement_type: null,
      exclude_from_volume: false,
    });
    expect(insertedTemplates(inserted)[0].exercises.map(e => e.exerciseId)).toEqual([BENCH, 'custom-row-0']);
  });

  it('inserts a full definition and a stub in one batch with the same column shape', async () => {
    const { client, inserted } = fakeSupabase();
    const defined = shared();
    const snap = templateSnapshot(
      { id: 'tpl', name: 'Push', exercises: [templateExercise(defined.sourceId), templateExercise(GHOST)] },
      [{ exerciseId: defined.sourceId, name: defined.name, icon: '🏋️' }, { exerciseId: GHOST, name: 'Sled Push', icon: '🏋️' }],
      [defined],
    );
    const result = await importSharedSnapshot(client, 'user-1', snap, 'Push');

    expect(result).toMatchObject({ customExercisesCreated: 2, exercisesDropped: 0 });
    const [full, stub] = inserted.custom_exercises;
    expect(full).toMatchObject({ name: 'Banded Clamshell', primary_body_part: 'Glutes', equipment: 'Band' });
    expect(Object.keys(stub).sort()).toEqual(Object.keys(full).sort());
    expect(insertedTemplates(inserted)[0].exercises.map(e => e.exerciseId)).toEqual(['custom-row-0', 'custom-row-1']);
  });

  it('reuses a row the viewer already has under that name rather than creating one', async () => {
    const { client, inserted } = fakeSupabase([{ id: 'mine', name: 'sled push' }]);
    const snap = templateSnapshot(
      { id: 'tpl', name: 'Push', exercises: [templateExercise(GHOST)] },
      [{ exerciseId: GHOST, name: 'Sled Push', icon: '🏋️' }],
    );
    const result = await importSharedSnapshot(client, 'user-1', snap, 'Push');

    expect(result).toMatchObject({ customExercisesCreated: 0, exercisesDropped: 0 });
    expect(inserted.custom_exercises).toBeUndefined();
    expect(insertedTemplates(inserted)[0].exercises[0].exerciseId).toBe('custom-mine');
  });

  it('drops an id with no name either, and unlinks the superset partner it leaves behind', async () => {
    const { client, inserted } = fakeSupabase();
    const snap = templateSnapshot(
      {
        id: 'tpl',
        name: 'Push',
        exercises: [
          templateExercise(BENCH, { setType: 'superset', supersetGroup: 1 }),
          templateExercise(GHOST, { setType: 'superset', supersetGroup: 1 }),
        ],
      },
      // The builders write the raw id as the name when the library could not resolve it.
      [{ exerciseId: BENCH, name: 'Flat Barbell Bench Press', icon: '💪' }, { exerciseId: GHOST, name: GHOST, icon: '🏋️' }],
    );
    const result = await importSharedSnapshot(client, 'user-1', snap, 'Push');

    expect(result).toMatchObject({ templatesCreated: 1, customExercisesCreated: 0, exercisesDropped: 1 });
    expect(inserted.custom_exercises).toBeUndefined();
    const [template] = insertedTemplates(inserted);
    expect(template.exercises).toHaveLength(1);
    expect(template.exercises[0]).toMatchObject({ exerciseId: BENCH, setType: 'normal' });
    expect(template.exercises[0].supersetGroup).toBeUndefined();
  });

  it('a session names its exercises on the log itself', async () => {
    const { client, inserted } = fakeSupabase();
    const set = { setNumber: 1, type: 'normal' as const, reps: 10, weight: 40 };
    const snap: SessionSnapshot = {
      version: SHARE_SNAPSHOT_VERSION,
      sharedAt: '2026-09-19T00:00:00.000Z',
      weightUnit: 'kg',
      sharedBy: null,
      customExercises: [],
      kind: 'session',
      session: {
        id: 'sess',
        date: '2026-09-18',
        exercises: [
          { exerciseId: BENCH, exerciseName: 'Flat Barbell Bench Press', sets: [set] },
          { exerciseId: GHOST, exerciseName: 'Sled Push', sets: [set] },
          { exerciseId: 'custom-nameless', exerciseName: 'custom-nameless', sets: [set] },
        ],
        duration: 1800,
        totalVolume: 1200,
        totalSets: 3,
        totalReps: 30,
      },
    };
    const result = await importSharedSnapshot(client, 'user-1', snap, 'Thursday');

    expect(result).toMatchObject({ templatesCreated: 1, customExercisesCreated: 1, exercisesDropped: 1 });
    expect(inserted.custom_exercises[0]).toMatchObject({ name: 'Sled Push' });
    expect(insertedTemplates(inserted)[0].exercises.map(e => e.exerciseId)).toEqual([BENCH, 'custom-row-0']);
  });

  it('counts drops across a program and still imports a template it empties', async () => {
    const { client, inserted } = fakeSupabase();
    const snap: ProgramSnapshot = {
      version: SHARE_SNAPSHOT_VERSION,
      sharedAt: '2026-09-19T00:00:00.000Z',
      weightUnit: 'kg',
      sharedBy: null,
      customExercises: [],
      kind: 'program',
      program: {
        id: 'prog',
        name: 'Block',
        days: [{ label: 'Day 1', templateId: 'tpl-a' }, { label: 'Day 2', templateId: 'tpl-b' }],
      },
      templates: [
        { id: 'tpl-a', name: 'A', exercises: [templateExercise(BENCH), templateExercise(GHOST)] },
        { id: 'tpl-b', name: 'B', exercises: [templateExercise('custom-other-ghost')] },
      ],
      exerciseMeta: [
        { exerciseId: BENCH, name: 'Flat Barbell Bench Press', icon: '💪' },
        { exerciseId: GHOST, name: GHOST, icon: '🏋️' },
        { exerciseId: 'custom-other-ghost', name: 'custom-other-ghost', icon: '🏋️' },
      ],
    };
    const result = await importSharedSnapshot(client, 'user-1', snap, 'Block');

    expect(result).toMatchObject({ templatesCreated: 2, programsCreated: 1, exercisesDropped: 2 });
    const templates = insertedTemplates(inserted);
    expect(templates.map(t => t.exercises.length)).toEqual([1, 0]);
  });
});
