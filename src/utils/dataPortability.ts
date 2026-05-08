import type { SupabaseClient } from '@supabase/supabase-js';

const EXPORT_VERSION = 1;

export interface RepVisionBackup {
  version: number;
  exportedAt: string;
  data: {
    workout_sessions: any[];
    workout_templates: any[];
    workout_programs: any[];
    future_workouts: any[];
    custom_exercises: any[];
    user_settings: any | null;
    profile: any | null;
  };
}

export function getBackupCounts(backup: RepVisionBackup) {
  const d = backup.data;
  return {
    sessions: d.workout_sessions?.length ?? 0,
    templates: d.workout_templates?.length ?? 0,
    programs: d.workout_programs?.length ?? 0,
    futureWorkouts: d.future_workouts?.length ?? 0,
    customExercises: d.custom_exercises?.length ?? 0,
    hasSettings: !!d.user_settings,
    hasProfile: !!d.profile,
  };
}

export async function exportUserData(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const [sessions, templates, programs, futureWorkouts, settings, profile, customExercises] =
    await Promise.all([
      supabase.from('workout_sessions').select('*').eq('user_id', userId),
      supabase.from('workout_templates').select('*').eq('user_id', userId),
      supabase.from('workout_programs').select('*').eq('user_id', userId),
      supabase.from('future_workouts').select('*').eq('user_id', userId),
      supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('custom_exercises').select('*').eq('user_id', userId),
    ]);

  const backup: RepVisionBackup = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      workout_sessions: sessions.data ?? [],
      workout_templates: templates.data ?? [],
      workout_programs: programs.data ?? [],
      future_workouts: futureWorkouts.data ?? [],
      custom_exercises: customExercises.data ?? [],
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
  return (
    typeof d.version === 'number' &&
    d.data &&
    Array.isArray(d.data.workout_sessions) &&
    Array.isArray(d.data.workout_templates) &&
    Array.isArray(d.data.workout_programs) &&
    Array.isArray(d.data.future_workouts) &&
    Array.isArray(d.data.custom_exercises)
  );
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

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message ?? 'Import failed' };
  }
}
