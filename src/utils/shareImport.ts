import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShareSnapshot, SharedCustomExercise } from '@/types/share';
import type { WorkoutTemplate } from '@/types/workout';
import { remapProgram, remapTemplate } from '@/utils/shareSnapshot';
import { templateFromSession } from '@/hooks/useScreenHelpers';

/**
 * Copy a shared snapshot into the signed-in viewer's own library.
 *
 * The supabase client and user id are injected rather than pulled from a hook,
 * matching `dataPortability.ts` — the public share page has no `useStorage`
 * mounted, and it keeps this callable from a test.
 */

export interface ImportResult {
  templatesCreated: number;
  programsCreated: number;
  customExercisesCreated: number;
}

type CustomExerciseRow = { id: string; name: string };

const normalizeName = (name: string) => name.trim().toLowerCase();

/**
 * Map the snapshot's `custom-<sharer uuid>` ids onto the viewer's own rows,
 * creating any they don't already have. Without this an imported template
 * references exercises that don't exist for the viewer: names render as raw
 * ids, and the logging screen falls back to reps-and-weight regardless of the
 * exercise's real measurement type.
 */
async function reconcileCustomExercises(
  supabase: SupabaseClient,
  userId: string,
  shared: SharedCustomExercise[],
): Promise<{ map: Record<string, string>; created: number }> {
  if (shared.length === 0) return { map: {}, created: 0 };

  const { data: existing, error } = await supabase
    .from('custom_exercises')
    .select('id, name')
    .eq('user_id', userId);
  if (error) throw error;

  const byName = new Map<string, string>();
  for (const row of (existing ?? []) as CustomExerciseRow[]) {
    byName.set(normalizeName(row.name), row.id);
  }

  const map: Record<string, string> = {};
  const toCreate: SharedCustomExercise[] = [];
  for (const ce of shared) {
    const match = byName.get(normalizeName(ce.name));
    // Matching on name means importing the same link twice reuses the
    // exercise rather than piling up duplicate "Sled Push" rows.
    if (match) map[ce.sourceId] = `custom-${match}`;
    else toCreate.push(ce);
  }

  if (toCreate.length === 0) return { map, created: 0 };

  const rows = toCreate.map(ce => ({
    user_id: userId,
    name: ce.name,
    primary_body_part: ce.primaryBodyPart,
    equipment: ce.equipment,
    difficulty: ce.difficulty,
    exercise_type: ce.exerciseType,
    movement_pattern: ce.movementPattern,
    secondary_muscles: ce.secondaryMuscles,
    is_recovery: ce.isRecovery,
    measurement_type: ce.measurementType ?? null,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('custom_exercises')
    .insert(rows as never)
    .select('id, name');
  if (insertError) throw insertError;

  const insertedByName = new Map<string, string>();
  for (const row of (inserted ?? []) as CustomExerciseRow[]) {
    insertedByName.set(normalizeName(row.name), row.id);
  }
  for (const ce of toCreate) {
    const id = insertedByName.get(normalizeName(ce.name));
    if (id) map[ce.sourceId] = `custom-${id}`;
  }

  return { map, created: inserted?.length ?? 0 };
}

async function insertTemplates(
  supabase: SupabaseClient,
  userId: string,
  templates: WorkoutTemplate[],
): Promise<void> {
  if (templates.length === 0) return;
  const { error } = await supabase.from('workout_templates').insert(
    templates.map(t => ({
      id: t.id,
      user_id: userId,
      name: t.name,
      exercises: t.exercises as unknown as never,
    })) as never,
  );
  if (error) throw error;
}

export async function importSharedSnapshot(
  supabase: SupabaseClient,
  userId: string,
  snapshot: ShareSnapshot,
  titleFallback: string,
): Promise<ImportResult> {
  const { map: exerciseIdMap, created: customExercisesCreated } =
    await reconcileCustomExercises(supabase, userId, snapshot.customExercises);

  if (snapshot.kind === 'template' || snapshot.kind === 'session') {
    const source = snapshot.kind === 'template'
      ? snapshot.template
      // A logged session isn't a template, so turn it into one — that's the
      // only shape the recipient can actually reuse.
      : templateFromSession(snapshot.session, titleFallback);
    const copy = remapTemplate(source, exerciseIdMap);
    await insertTemplates(supabase, userId, [copy]);
    return { templatesCreated: 1, programsCreated: 0, customExercisesCreated };
  }

  // Programs: create the embedded templates first so the day list can point at
  // the recipient's new ids.
  const templateIdMap: Record<string, string> = {};
  const copies = snapshot.templates.map(t => {
    const copy = remapTemplate(t, exerciseIdMap);
    templateIdMap[t.id] = copy.id;
    return copy;
  });
  await insertTemplates(supabase, userId, copies);

  const program = remapProgram(snapshot.program, templateIdMap);
  const { error } = await supabase.from('workout_programs').insert({
    id: program.id,
    user_id: userId,
    name: program.name,
    days: program.days as unknown as never,
    duration_weeks: program.durationWeeks ?? 8,
    // start_date is left null and the program is NOT made active: activating
    // it would regenerate the viewer's future_workouts, which is destructive
    // and not something opening a link should do. They activate it themselves.
    start_date: null,
  } as never);
  if (error) throw error;

  return {
    templatesCreated: copies.length,
    programsCreated: 1,
    customExercisesCreated,
  };
}
