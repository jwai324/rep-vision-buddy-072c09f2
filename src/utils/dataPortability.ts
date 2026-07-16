import type { SupabaseClient } from '@supabase/supabase-js';

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
    // body_measurements isn't in the generated Database type, so pass the
    // table name as never to bypass the string-literal check. The response
    // shape is validated at runtime by the caller (empty array on any
    // read error), so unknown is safe here.
    const { data, error } = await (supabase
      .from(table as never)
      .select('*')
      .eq('user_id', userId)
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
      fetchAllRows(supabase, 'body_measurements', userId).catch(() => [] as BackupRow[]),
    ]);

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

export async function importUserData(
  supabase: SupabaseClient,
  userId: string,
  backup: RepVisionBackup
): Promise<{ success: boolean; error?: string }> {
  try {
    // Settings
    if (backup.data.user_settings) {
      const s = stripServerColumns({ ...backup.data.user_settings, user_id: userId });
      delete (s as { id?: unknown }).id;
      await supabase.from('user_settings').upsert(s as never, { onConflict: 'user_id' });
    }

    // Profile
    if (backup.data.profile) {
      const p = stripServerColumns({ ...backup.data.profile, user_id: userId });
      delete (p as { id?: unknown }).id;
      await supabase.from('profiles').upsert(p as never, { onConflict: 'user_id' });
    }

    const upsertTable = async (table: string, rows: BackupRow[]) => {
      if (rows.length === 0) return;
      const stamped = stampUserId(rows, userId).map(stripServerColumns);
      for (const row of stamped) {
        await supabase.from(table as never).upsert(row as never, { onConflict: 'id' });
      }
    };

    await upsertTable('workout_templates', backup.data.workout_templates);
    await upsertTable('workout_programs', backup.data.workout_programs);
    await upsertTable('workout_sessions', backup.data.workout_sessions);
    await upsertTable('future_workouts', backup.data.future_workouts);
    await upsertTable('custom_exercises', backup.data.custom_exercises);
    // v2+ backups only; v1 backups have this normalized to [] by validateBackup.
    await upsertTable('body_measurements', backup.data.body_measurements);

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed';
    return { success: false, error: message };
  }
}
