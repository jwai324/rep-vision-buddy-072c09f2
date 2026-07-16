import type { SupabaseClient } from '@supabase/supabase-js';

// v1 backups (pre-body_measurements) still import cleanly — the field is
// treated as empty when missing. Bumped to 2 so we can distinguish shapes.
const EXPORT_VERSION = 2;

// PostgREST default cap per request is 1000 rows; loop with .range() so users
// with many years of history get a complete backup instead of silent truncation.
const PAGE_SIZE = 1000;

export interface RepVisionBackup {
  version: number;
  exportedAt: string;
  data: {
    workout_sessions: any[];
    workout_templates: any[];
    workout_programs: any[];
    future_workouts: any[];
    custom_exercises: any[];
    body_measurements: any[];
    user_settings: any | null;
    profile: any | null;
  };
}

async function fetchAllRows(
  supabase: SupabaseClient,
  table: string,
  userId: string,
): Promise<any[]> {
  const rows: any[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .range(offset, offset + PAGE_SIZE - 1);
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
      fetchAllRows(supabase, 'body_measurements', userId).catch(() => [] as any[]),
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
      user_settings: settings.data ?? null,
      profile: profile.data ?? null,
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
  const d = data as any;
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

function stampUserId<T extends Record<string, any>>(rows: T[], userId: string): T[] {
  return rows.map(r => ({ ...r, user_id: userId }));
}

export async function importUserData(
  supabase: SupabaseClient,
  userId: string,
  backup: RepVisionBackup
): Promise<{ success: boolean; error?: string }> {
  try {
    // Settings
    if (backup.data.user_settings) {
      const s = { ...backup.data.user_settings, user_id: userId };
      delete s.id;
      delete s.created_at;
      delete s.updated_at;
      await supabase.from('user_settings').upsert({ ...s, user_id: userId }, { onConflict: 'user_id' });
    }

    // Profile
    if (backup.data.profile) {
      const p = { ...backup.data.profile, user_id: userId };
      delete p.id;
      delete p.created_at;
      delete p.updated_at;
      await supabase.from('profiles').upsert({ ...p, user_id: userId }, { onConflict: 'user_id' });
    }

    // Templates
    if (backup.data.workout_templates.length > 0) {
      const rows = stampUserId(backup.data.workout_templates, userId);
      for (const row of rows) {
        delete row.created_at;
        delete row.updated_at;
        await supabase.from('workout_templates').upsert(row, { onConflict: 'id' });
      }
    }

    // Programs
    if (backup.data.workout_programs.length > 0) {
      const rows = stampUserId(backup.data.workout_programs, userId);
      for (const row of rows) {
        delete row.created_at;
        delete row.updated_at;
        await supabase.from('workout_programs').upsert(row, { onConflict: 'id' });
      }
    }

    // Sessions
    if (backup.data.workout_sessions.length > 0) {
      const rows = stampUserId(backup.data.workout_sessions, userId);
      for (const row of rows) {
        delete row.created_at;
        delete row.updated_at;
        await supabase.from('workout_sessions').upsert(row, { onConflict: 'id' });
      }
    }

    // Future workouts
    if (backup.data.future_workouts.length > 0) {
      const rows = stampUserId(backup.data.future_workouts, userId);
      for (const row of rows) {
        delete row.created_at;
        delete row.updated_at;
        await supabase.from('future_workouts').upsert(row, { onConflict: 'id' });
      }
    }

    // Custom exercises
    if (backup.data.custom_exercises.length > 0) {
      const rows = stampUserId(backup.data.custom_exercises, userId);
      for (const row of rows) {
        delete row.created_at;
        delete row.updated_at;
        await supabase.from('custom_exercises').upsert(row, { onConflict: 'id' });
      }
    }

    // Body measurements (v2+ backups; v1 backups have this normalized to []
    // by validateBackup, so this block is a no-op for old files).
    if (backup.data.body_measurements.length > 0) {
      const rows = stampUserId(backup.data.body_measurements, userId);
      for (const row of rows) {
        delete row.created_at;
        delete row.updated_at;
        await supabase.from('body_measurements').upsert(row, { onConflict: 'id' });
      }
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Import failed' };
  }
}
