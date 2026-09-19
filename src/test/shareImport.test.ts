import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { importSharedSnapshot } from '@/utils/shareImport';
import { SHARE_SNAPSHOT_VERSION, type SharedCustomExercise, type TemplateSnapshot } from '@/types/share';

/**
 * Just enough of the client for `importSharedSnapshot`: the viewer owns no
 * custom exercises yet, and every insert echoes its rows back with ids.
 */
function fakeSupabase() {
  const inserted: Record<string, Record<string, unknown>[]> = {};
  const client = {
    from: (table: string) => ({
      select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
      insert: (rows: unknown) => {
        const list = (Array.isArray(rows) ? rows : [rows]) as Record<string, unknown>[];
        (inserted[table] ??= []).push(...list);
        const result = {
          data: list.map((row, i) => ({ id: `row-${i}`, name: row.name })),
          error: null,
        };
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
