import { EXERCISES } from '@/types/workout';
import { getBodyPartIcon } from '@/data/exercises';
import type { Exercise } from '@/data/exercises';
import type {
  ProgramSnapshot,
  SessionSnapshot,
  SharedCustomExercise,
  SharedExerciseMeta,
  TemplateSnapshot,
} from '@/types/share';
import { SHARE_SNAPSHOT_VERSION } from '@/types/share';
import type {
  ExerciseId,
  WorkoutProgram,
  WorkoutSession,
  WorkoutTemplate,
} from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';

/**
 * Snapshot builders and the id-remapping half of import.
 *
 * Everything here is pure and takes its data as arguments — no hooks, no
 * supabase — so the whole share → import round trip is unit-testable.
 */

/** The element shape of `useCustomExercisesContext().exercises`. */
export type CustomExerciseLite = Exercise & { isCustom: true; isRecovery: boolean };

export interface SnapshotContext {
  weightUnit: WeightUnit;
  sharedBy: string | null;
  customExercises: CustomExerciseLite[];
  /** Injected in tests; defaults to the real clock. */
  now?: () => string;
}

/** Custom exercise ids are minted as `custom-<row uuid>` by useCustomExercises. */
export function isCustomExerciseId(id: string): boolean {
  return id.startsWith('custom-');
}

/**
 * Merged id → {name, icon} lookup over built-ins and the given custom
 * exercises. Same merge as `useExerciseLookup`, but as a plain function so the
 * snapshot builders can use it outside React.
 */
export function buildExerciseLookup(
  customExercises: CustomExerciseLite[],
): Record<string, { name: string; icon: string }> {
  const lookup: Record<string, { name: string; icon: string }> = { ...EXERCISES };
  for (const ce of customExercises) {
    lookup[ce.id] = { name: ce.name, icon: getBodyPartIcon(ce.primaryBodyPart) };
  }
  return lookup;
}

function toExerciseMeta(
  ids: ExerciseId[],
  lookup: Record<string, { name: string; icon: string }>,
): SharedExerciseMeta[] {
  return ids.map(exerciseId => ({
    exerciseId,
    // An id with no entry means the exercise was deleted before sharing. Fall
    // back to the raw id so the viewer sees *something* rather than a blank row.
    name: lookup[exerciseId]?.name ?? exerciseId,
    icon: lookup[exerciseId]?.icon ?? '🏋️',
  }));
}

function pickCustomExercises(
  ids: ExerciseId[],
  customExercises: CustomExerciseLite[],
): SharedCustomExercise[] {
  const wanted = new Set(ids.filter(isCustomExerciseId));
  return customExercises
    .filter(ce => wanted.has(ce.id))
    .map(ce => ({
      sourceId: ce.id,
      name: ce.name,
      primaryBodyPart: ce.primaryBodyPart,
      equipment: ce.equipment,
      difficulty: ce.difficulty,
      exerciseType: ce.exerciseType,
      movementPattern: ce.movementPattern,
      secondaryMuscles: ce.secondaryMuscles ?? [],
      isRecovery: ce.isRecovery,
      measurementType: ce.measurementType ?? null,
    }));
}

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function base(ctx: SnapshotContext, ids: ExerciseId[]) {
  return {
    version: SHARE_SNAPSHOT_VERSION,
    sharedAt: (ctx.now ?? (() => new Date().toISOString()))(),
    weightUnit: ctx.weightUnit,
    sharedBy: ctx.sharedBy,
    customExercises: pickCustomExercises(ids, ctx.customExercises),
  };
}

export function buildSessionSnapshot(
  session: WorkoutSession,
  ctx: SnapshotContext,
): SessionSnapshot {
  const ids = uniq(session.exercises.map(e => e.exerciseId));
  return {
    ...base(ctx, ids),
    kind: 'session',
    session: {
      id: session.id,
      date: session.date,
      startedAt: session.startedAt,
      // ExerciseLog already embeds exerciseName, so a shared session renders
      // custom exercises correctly without any lookup on the viewer's side.
      exercises: session.exercises,
      duration: session.duration,
      totalVolume: session.totalVolume,
      totalSets: session.totalSets,
      totalReps: session.totalReps,
      averageRpe: session.averageRpe,
      note: session.note,
      // `location` is deliberately omitted — it can name the sharer's home gym
      // or workplace, which is not something a link should publish.
      isRestDay: session.isRestDay,
      recoveryActivities: session.recoveryActivities,
    },
  };
}

export function buildTemplateSnapshot(
  template: WorkoutTemplate,
  ctx: SnapshotContext,
): TemplateSnapshot {
  const ids = uniq(template.exercises.map(e => e.exerciseId));
  const lookup = buildExerciseLookup(ctx.customExercises);
  return {
    ...base(ctx, ids),
    kind: 'template',
    template,
    exerciseMeta: toExerciseMeta(ids, lookup),
  };
}

export function buildProgramSnapshot(
  program: WorkoutProgram,
  allTemplates: WorkoutTemplate[],
  ctx: SnapshotContext,
): ProgramSnapshot {
  // A program references templates by id inside its `days` JSON with no
  // foreign key, so an id can dangle after the template is deleted. Those are
  // dropped from `templates`; the day itself is kept so the schedule still
  // reads correctly, and the viewer sees the day with no detail.
  const referenced = uniq(
    program.days.map(d => d.templateId).filter(id => id !== 'rest'),
  );
  const templates = referenced
    .map(id => allTemplates.find(t => t.id === id))
    .filter((t): t is WorkoutTemplate => !!t);

  const ids = uniq(templates.flatMap(t => t.exercises.map(e => e.exerciseId)));
  const lookup = buildExerciseLookup(ctx.customExercises);
  return {
    ...base(ctx, ids),
    kind: 'program',
    program,
    templates,
    exerciseMeta: toExerciseMeta(ids, lookup),
  };
}

/* ------------------------------------------------------------------ */
/* Import side: id remapping                                          */
/* ------------------------------------------------------------------ */

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Copy a template for a new owner: fresh template id, and every `exerciseId`
 * run through `exerciseIdMap` so the sharer's `custom-<uuid>` ids point at the
 * recipient's own rows. Ids absent from the map pass through — that's the
 * normal case for built-in exercises.
 */
export function remapTemplate(
  template: WorkoutTemplate,
  exerciseIdMap: Record<string, string>,
): WorkoutTemplate {
  return {
    ...template,
    id: newId(),
    exercises: template.exercises.map(ex => ({
      ...ex,
      exerciseId: exerciseIdMap[ex.exerciseId] ?? ex.exerciseId,
    })),
  };
}

/**
 * Copy a program for a new owner. `templateIdMap` must already contain an
 * entry for every non-rest day, built by remapping the embedded templates
 * first. `'rest'` passes through untouched, as does any dangling id.
 */
export function remapProgram(
  program: WorkoutProgram,
  templateIdMap: Record<string, string>,
): WorkoutProgram {
  return {
    ...program,
    id: newId(),
    days: program.days.map(day => ({
      ...day,
      templateId:
        day.templateId === 'rest'
          ? 'rest'
          : templateIdMap[day.templateId] ?? day.templateId,
    })),
  };
}
