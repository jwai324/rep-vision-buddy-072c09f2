import type { SupabaseClient } from '@supabase/supabase-js';
import { sanitizeProgramDays } from '@/utils/programFrequency';
import type { ProgramDay } from '@/types/workout';

// v1 backups (pre-body_measurements) still import cleanly — the field is
// treated as empty when missing. Bumped to 2 so we can distinguish shapes.
const EXPORT_VERSION = 2;

// PostgREST default cap per request is 1000 rows; loop with .range() so users
// with many years of history get a complete backup instead of silent truncation.
const PAGE_SIZE = 1000;

// A row read from any of the exported tables. We can't reuse the generated
// Database Row types because the backup file is a snapshot of whatever
// columns existed at export time — the shape must survive schema drift, so
// we treat each row as an opaque bag of properties for typing purposes.
type BackupRow = Record<string, unknown>;

export interface RepVisionBackup {
  version: number;
  exportedAt: string;
  data: {
    workout_sessions: BackupRow[];
    workout_templates: BackupRow[];
    workout_programs: BackupRow[];
    future_workouts: BackupRow[];
    custom_exercises: BackupRow[];
    body_measurements: BackupRow[];
    user_settings: BackupRow | null;
    profile: BackupRow | null;
  };
}

async function fetchAllRows(
  supabase: SupabaseClient,
  table: string,
  userId: string,
): Promise<BackupRow[]> {
  const rows: BackupRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    // The table name is a plain string here, so it is passed as never to get
    // past the string-literal check; the rows are treated as opaque bags.
    // Pages are only stable under a total order: without one, Postgres is
    // free to hand back overlapping or gapped pages, and a table past
    // PAGE_SIZE rows backed up with rows doubled or missing.
    const { data, error } = await (supabase
      .from(table as never)
      .select('*')
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1) as unknown as Promise<{ data: BackupRow[] | null; error: unknown }>);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}

export function getBackupCounts(backup: RepVisionBackup) {
  const d = backup.data;
  return {
    sessions: d.workout_sessions?.length ?? 0,
    templates: d.workout_templates?.length ?? 0,
    programs: d.workout_programs?.length ?? 0,
    futureWorkouts: d.future_workouts?.length ?? 0,
    customExercises: d.custom_exercises?.length ?? 0,
    bodyMeasurements: d.body_measurements?.length ?? 0,
    hasSettings: !!d.user_settings,
    hasProfile: !!d.profile,
  };
}

export async function exportUserData(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const [sessions, templates, programs, futureWorkouts, settings, profile, customExercises, bodyMeasurements] =
    await Promise.all([
      fetchAllRows(supabase, 'workout_sessions', userId),
      fetchAllRows(supabase, 'workout_templates', userId),
      fetchAllRows(supabase, 'workout_programs', userId),
      fetchAllRows(supabase, 'future_workouts', userId),
      supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      fetchAllRows(supabase, 'custom_exercises', userId),
      fetchAllRows(supabase, 'body_measurements', userId),
    ]);
  // Single-row reads resolve with an error payload rather than rejecting. Left
  // unread, a failed one wrote a backup with that section null and reported
  // "Export complete" — and a restore from it skips the section silently.
  if (settings.error) throw settings.error;
  if (profile.error) throw profile.error;

  const backup: RepVisionBackup = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      workout_sessions: sessions,
      workout_templates: templates,
      workout_programs: programs,
      future_workouts: futureWorkouts,
      custom_exercises: customExercises,
      body_measurements: bodyMeasurements,
      user_settings: (settings.data ?? null) as BackupRow | null,
      profile: (profile.data ?? null) as BackupRow | null,
    },
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `repvision-backup-${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function validateBackup(data: unknown): data is RepVisionBackup {
  if (!data || typeof data !== 'object') return false;
  const d = data as { version?: unknown; data?: Record<string, unknown> };
  if (typeof d.version !== 'number' || !d.data) return false;
  const ok = (
    Array.isArray(d.data.workout_sessions) &&
    Array.isArray(d.data.workout_templates) &&
    Array.isArray(d.data.workout_programs) &&
    Array.isArray(d.data.future_workouts) &&
    Array.isArray(d.data.custom_exercises)
  );
  if (!ok) return false;
  // v1 backups don't include body_measurements — normalize to empty so the
  // importer and downstream typing can treat every backup uniformly.
  if (!Array.isArray(d.data.body_measurements)) d.data.body_measurements = [];
  return true;
}

function stampUserId(rows: BackupRow[], userId: string): BackupRow[] {
  return rows.map(r => ({ ...r, user_id: userId }));
}

// Rows read from a backup can carry legacy timestamp/id fields. Strip them
// before an upsert so Postgres regenerates fresh values.
function stripServerColumns(row: BackupRow): BackupRow {
  const { created_at: _c, updated_at: _u, ...rest } = row;
  void _c; void _u;
  return rest;
}

export interface ImportResult {
  success: boolean;
  error?: string;
  /** Rows written per table, in the order they were written. */
  imported?: Record<string, number>;
}

// PostgREST caps the request body, and one rejected row fails its whole batch,
// so keep batches small enough that a failure names a narrow slice of the file.
const IMPORT_BATCH_SIZE = 200;

type UpsertError = { message?: string; code?: string; details?: string } | null;

function describeFailure(table: string, error: UpsertError, imported: Record<string, number>): string {
  // 42501 is what a backup exported from a different account produces: rows
  // keep their original ids, so `ON CONFLICT (id) DO UPDATE` targets rows the
  // other account still owns and the owner-only policy rejects the update.
  const reason = error?.code === '42501'
    ? 'the database refused them — rows in this backup are still owned by the account it was exported from. Restore it into that account, or into a fresh project.'
    : (error?.message || 'the request failed. Check your connection and try again.');
  const done = Object.entries(imported).map(([t, n]) => `${t} ${n}`).join(', ');
  const partial = done
    ? ` Already restored before this point: ${done}. Nothing after it was written, so your account is partially restored — keep the backup file and re-run the import once the cause is fixed.`
    : ' Nothing was written.';
  return `Importing ${table} failed: ${reason}${partial}`;
}

export async function importUserData(
  supabase: SupabaseClient,
  userId: string,
  backup: RepVisionBackup
): Promise<ImportResult> {
  const imported: Record<string, number> = {};

  // postgrest-js resolves rather than rejects on transport failures too, so
  // every write has to be checked; the old code read none of them and reported
  // success over an account where nothing had landed.
  const upsert = async (table: string, rows: BackupRow[], onConflict: string): Promise<UpsertError> => {
    for (let i = 0; i < rows.length; i += IMPORT_BATCH_SIZE) {
      const batch = rows.slice(i, i + IMPORT_BATCH_SIZE);
      const { error } = await (supabase
        .from(table as never)
        .upsert(batch as never, { onConflict }) as unknown as Promise<{ error: UpsertError }>);
      if (error) return error;
    }
    return null;
  };

  try {
    if (backup.data.user_settings) {
      const s = stripServerColumns({ ...backup.data.user_settings, user_id: userId });
      delete (s as { id?: unknown }).id;
      const error = await upsert('user_settings', [s], 'user_id');
      if (error) return { success: false, error: describeFailure('user_settings', error, imported), imported };
      imported.user_settings = 1;
    }

    if (backup.data.profile) {
      const p = stripServerColumns({ ...backup.data.profile, user_id: userId });
      delete (p as { id?: unknown }).id;
      const error = await upsert('profiles', [p], 'user_id');
      if (error) return { success: false, error: describeFailure('profiles', error, imported), imported };
      imported.profile = 1;
    }

    // Referenced-before-referencing, so stopping partway leaves the fewest
    // dangling rows: custom exercises are named by `custom-<uuid>` inside every
    // template, program, session and scheduled workout, and templates are named
    // by programs and scheduled workouts.
    const tables: Array<[string, BackupRow[]]> = [
      ['custom_exercises', backup.data.custom_exercises],
      ['workout_templates', backup.data.workout_templates],
      ['workout_programs', backup.data.workout_programs],
      ['workout_sessions', backup.data.workout_sessions],
      ['future_workouts', backup.data.future_workouts],
      // v2+ backups only; v1 backups have this normalized to [] by validateBackup.
      ['body_measurements', backup.data.body_measurements],
    ];

    for (const [table, rows] of tables) {
      if (!rows || rows.length === 0) continue;
      let stamped = stampUserId(rows, userId).map(stripServerColumns);
      if (table === 'workout_programs') {
        // A backup is a file: its frequencies were never validated, and an
        // interval of 0 hangs the scheduler on the next load.
        stamped = stamped.map(row => Array.isArray(row.days)
          ? { ...row, days: sanitizeProgramDays(row.days as ProgramDay[]) }
          : row);
      }
      const error = await upsert(table, stamped, 'id');
      if (error) return { success: false, error: describeFailure(table, error, imported), imported };
      imported[table] = stamped.length;
    }

    return { success: true, imported };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    return { success: false, error: message, imported };
  }
}
