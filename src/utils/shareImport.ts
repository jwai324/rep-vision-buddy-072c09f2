import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShareSnapshot, SharedCustomExercise } from '@/types/share';
import type { WorkoutTemplate } from '@/types/workout';
import { isCustomExerciseId, remapProgram, remapTemplate } from '@/utils/shareSnapshot';
import { withoutLoneSupersets } from '@/utils/templateSupersets';
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
  /**
   * Rows left out of the copy because the snapshot carried neither a
   * definition nor a name for their custom exercise id.
   */
  exercisesDropped: number;
}

/**
 * Shown verbatim when an import fails and left no workout of its own behind.
 * It says "no workouts" rather than "nothing": a custom exercise this import
 * created can survive a later failure, deliberately, because those are matched
 * by name and a retry reuses them instead of duplicating them.
 */
export const IMPORT_FAILED_MESSAGE =
  "Couldn't save this to your workouts. No workouts were added — try again.";

/**
 * Shown when the program row failed *and* taking its templates back out
 * failed too (the connection is still down). Saying "nothing was saved" here
 * would be a lie, and the user would find the strays later with no idea where
 * they came from.
 */
export const IMPORT_LEFTOVERS_MESSAGE =
  "Couldn't save this program to your workouts, and some of its workouts may have been "
  + 'left in your library. Check your templates before trying again.';

/**
 * A failed import, carrying a sentence the caller can show as-is.
 *
 * `cause` is a field rather than the ES2022 `Error` option because this
 * project compiles against the ES2020 lib; it holds the postgrest error so the
 * console log keeps the real detail.
 */
export class ShareImportError extends Error {
  readonly userMessage: string;
  /** Rows this import created are still in the viewer's library. */
  readonly leftBehind: boolean;
  readonly cause: unknown;

  constructor(userMessage: string, cause: unknown, leftBehind = false) {
    super(userMessage);
    this.name = 'ShareImportError';
    this.userMessage = userMessage;
    this.leftBehind = leftBehind;
    this.cause = cause;
  }
}

type CustomExerciseRow = { id: string; name: string };

/**
 * A custom exercise the snapshot names but does not define. The sharer's
 * library had not resolved the id when the payload was built (it loads after
 * mount, or the exercise had since been deleted), so only the name travelled;
 * the viewer's row is written with the table's defaults for everything else.
 */
type CustomExerciseStub = Pick<SharedCustomExercise, 'sourceId' | 'name'> & Partial<SharedCustomExercise>;

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
  shared: CustomExerciseStub[],
): Promise<{ map: Record<string, string>; created: number }> {
  if (shared.length === 0) return { map: {}, created: 0 };

  const { data: existing, error } = await supabase
    .from('custom_exercises')
    .select('id, name')
    .eq('user_id', userId);
  if (error) throw new ShareImportError(IMPORT_FAILED_MESSAGE, error);

  const byName = new Map<string, string>();
  for (const row of (existing ?? []) as CustomExerciseRow[]) {
    byName.set(normalizeName(row.name), row.id);
  }

  const map: Record<string, string> = {};
  const toCreate: CustomExerciseStub[] = [];
  for (const ce of shared) {
    const match = byName.get(normalizeName(ce.name));
    // Matching on name means importing the same link twice reuses the
    // exercise rather than piling up duplicate "Sled Push" rows.
    if (match) map[ce.sourceId] = `custom-${match}`;
    else toCreate.push(ce);
  }

  if (toCreate.length === 0) return { map, created: 0 };

  // A stub's missing fields are filled with the table's own defaults (the
  // `custom_exercises` migration) rather than left undefined: postgrest-js
  // lists every key of every row in the `columns=` param, `JSON.stringify`
  // then drops the undefined ones from the body, and PostgREST inserts NULL
  // for a listed column the payload does not carry — a NOT NULL refusal that
  // failed the whole import.
  const rows = toCreate.map(ce => ({
    user_id: userId,
    name: ce.name,
    primary_body_part: ce.primaryBodyPart ?? 'Full Body',
    equipment: ce.equipment ?? 'None',
    difficulty: ce.difficulty ?? 'Intermediate',
    exercise_type: ce.exerciseType ?? 'Isolation',
    movement_pattern: ce.movementPattern ?? 'Other',
    secondary_muscles: ce.secondaryMuscles ?? [],
    is_recovery: ce.isRecovery ?? false,
    measurement_type: ce.measurementType ?? null,
    exclude_from_volume: ce.excludeFromVolume ?? false,
  }));

  const { data: inserted, error: insertError } = await supabase
    .from('custom_exercises')
    .insert(rows as never)
    .select('id, name');
  if (insertError) throw new ShareImportError(IMPORT_FAILED_MESSAGE, insertError);

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

/**
 * The name a snapshot gives an exercise id, or nothing. Templates and programs
 * carry `exerciseMeta`; a session's logs embed the name. The builders write
 * the raw id in place of a name they could not resolve, so that reads as no
 * name either.
 */
function snapshotNameFor(snapshot: ShareSnapshot, exerciseId: string): string | null {
  const name = snapshot.kind === 'session'
    ? snapshot.session.exercises.find(e => e.exerciseId === exerciseId)?.exerciseName
    : snapshot.exerciseMeta.find(m => m.exerciseId === exerciseId)?.name;
  const trimmed = name?.trim() ?? '';
  return trimmed && trimmed !== exerciseId ? trimmed : null;
}

/**
 * Stubs for the custom ids the snapshot uses and names without defining.
 * Definitions are absent when the sharer's library had not resolved the id at
 * share time (ShareDialog now waits for it), and a payload frozen before that
 * guard is still out there. An id with no name either is left for
 * `withoutUnresolved`.
 */
function undefinedCustomExercises(snapshot: ShareSnapshot): CustomExerciseStub[] {
  const used = snapshot.kind === 'template' ? snapshot.template.exercises
    : snapshot.kind === 'session' ? snapshot.session.exercises
    : snapshot.templates.flatMap(t => t.exercises);
  const defined = new Set(snapshot.customExercises.map(ce => ce.sourceId));
  const stubs = new Map<string, CustomExerciseStub>();
  for (const { exerciseId } of used) {
    if (!isCustomExerciseId(exerciseId) || defined.has(exerciseId) || stubs.has(exerciseId)) continue;
    const name = snapshotNameFor(snapshot, exerciseId);
    if (name) stubs.set(exerciseId, { sourceId: exerciseId, name });
  }
  return Array.from(stubs.values());
}

/**
 * Leave out every row whose custom id the viewer's library cannot hold — no
 * definition and no name came with it, so a copy would render as a raw id and
 * log as reps-and-weight. A superset partner left on its own is unlinked. A
 * template emptied this way is still imported.
 */
function withoutUnresolved(
  template: WorkoutTemplate,
  exerciseIdMap: Record<string, string>,
): { template: WorkoutTemplate; dropped: number } {
  const kept = template.exercises.filter(e => !isCustomExerciseId(e.exerciseId) || e.exerciseId in exerciseIdMap);
  const dropped = template.exercises.length - kept.length;
  if (dropped === 0) return { template, dropped };
  return { template: { ...template, exercises: withoutLoneSupersets(kept) }, dropped };
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
  if (error) throw new ShareImportError(IMPORT_FAILED_MESSAGE, error);
}

/**
 * Take back the templates a failed program import just created.
 *
 * Only ids minted by this import are passed in (`remapTemplate` gives every
 * copy a fresh uuid), and the delete is scoped to the viewer's own rows, so a
 * template they already had cannot be caught by it. Answers `false` when the
 * rows are — or may still be — there, which is the difference between telling
 * the user nothing was saved and warning them to go and look.
 *
 * The trade this accepts: if the program row commits server-side but the
 * response is lost, the rollback removes templates a saved program points at,
 * leaving a program whose days name dead ids. That program is inert — it is
 * never activated, so no future_workouts are generated against those ids — and
 * the user can delete it, whereas a stray template is not deduped and comes
 * back a second time on every retry. Inserting the program first only points
 * the same hazard the other way.
 */
async function removeImportedTemplates(
  supabase: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<boolean> {
  if (ids.length === 0) return true;
  try {
    const { data, error } = await supabase
      .from('workout_templates')
      .delete()
      .eq('user_id', userId)
      .in('id', ids)
      // The returned rows are the proof: a delete that RLS refuses reports no
      // error and removes nothing, which must not read as a clean rollback.
      .select('id');
    if (error) return false;
    return (data ?? []).length === ids.length;
  } catch {
    return false;
  }
}

export async function importSharedSnapshot(
  supabase: SupabaseClient,
  userId: string,
  snapshot: ShareSnapshot,
  titleFallback: string,
): Promise<ImportResult> {
  const { map: exerciseIdMap, created: customExercisesCreated } = await reconcileCustomExercises(
    supabase,
    userId,
    [...snapshot.customExercises, ...undefinedCustomExercises(snapshot)],
  );

  if (snapshot.kind === 'template' || snapshot.kind === 'session') {
    const source = snapshot.kind === 'template'
      ? snapshot.template
      // A logged session isn't a template, so turn it into one — that's the
      // only shape the recipient can actually reuse.
      : templateFromSession(snapshot.session, titleFallback);
    const { template, dropped: exercisesDropped } = withoutUnresolved(source, exerciseIdMap);
    const copy = remapTemplate(template, exerciseIdMap);
    await insertTemplates(supabase, userId, [copy]);
    return { templatesCreated: 1, programsCreated: 0, customExercisesCreated, exercisesDropped };
  }

  // Programs: create the embedded templates first so the day list can point at
  // the recipient's new ids. Nothing dedupes a template on insert, so those
  // rows are rolled back if the program itself fails to save — otherwise the
  // user is told the import failed while holding its workouts, and every
  // retry lays down another copy of each.
  const templateIdMap: Record<string, string> = {};
  let exercisesDropped = 0;
  const copies = snapshot.templates.map(t => {
    const { template, dropped } = withoutUnresolved(t, exerciseIdMap);
    exercisesDropped += dropped;
    const copy = remapTemplate(template, exerciseIdMap);
    templateIdMap[t.id] = copy.id;
    return copy;
  });
  await insertTemplates(supabase, userId, copies);

  const program = remapProgram(snapshot.program, templateIdMap);
  let error: unknown;
  try {
    // postgrest-js resolves `{ error }` rather than throwing, offline
    // included; the catch is so that a throw cannot escape past the rollback.
    ({ error } = await supabase.from('workout_programs').insert({
      id: program.id,
      user_id: userId,
      name: program.name,
      days: program.days as unknown as never,
      duration_weeks: program.durationWeeks ?? 8,
      // start_date is left null and the program is NOT made active: activating
      // it would regenerate the viewer's future_workouts, which is destructive
      // and not something opening a link should do. They activate it themselves.
      start_date: null,
    } as never));
  } catch (thrown) {
    // Normalised rather than stored as-is: a falsy throw (`throw ''`) would
    // slip past the `if (error)` below and report the import as a success.
    error = thrown instanceof Error ? thrown : new Error(String(thrown));
  }
  if (error) {
    const cleaned = await removeImportedTemplates(supabase, userId, copies.map(c => c.id));
    // Custom exercises this import created are deliberately kept: they are
    // matched by name, so a retry reuses them instead of piling up duplicates,
    // and one may already be referenced by something the user did in between.
    throw new ShareImportError(
      cleaned ? IMPORT_FAILED_MESSAGE : IMPORT_LEFTOVERS_MESSAGE,
      error,
      !cleaned,
    );
  }

  return {
    templatesCreated: copies.length,
    programsCreated: 1,
    customExercisesCreated,
    exercisesDropped,
  };
}
