import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import { addDays, addWeeks, getDay, format } from 'date-fns';
import { parseLocalDate } from '@/utils/dateUtils';

function generateFutureWorkouts(program: WorkoutProgram): Omit<FutureWorkout, 'id'>[] {
  const workouts: Omit<FutureWorkout, 'id'>[] = [];
  const start = program.startDate ? new Date(program.startDate + 'T00:00:00') : new Date();
  const endDate = addWeeks(start, program.durationWeeks ?? 8);
  const scheduledDates = new Set<string>();

  program.days.forEach((day) => {
    if (!day.frequency) return;
    const freq = day.frequency;

    const addEvent = (date: Date) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      scheduledDates.add(dateStr);
      workouts.push({
        programId: program.id,
        date: dateStr,
        templateId: day.templateId,
        label: day.label,
      });
    };

    if (freq.type === 'weekly') {
      const targetDay = freq.weekday;
      const currentDay = getDay(start);
      const diff = (targetDay - currentDay + 7) % 7;
      let current = addDays(start, diff);
      while (current < endDate) {
        addEvent(current);
        current = addDays(current, 7);
      }
    } else if (freq.type === 'everyNDays') {
      const origin = freq.startDate ? parseLocalDate(freq.startDate) : new Date(start);
      let current = new Date(origin);
      while (current < endDate) {
        if (current >= start) {
          addEvent(current);
        }
        current = addDays(current, freq.interval);
      }
    } else if (freq.type === 'monthly') {
      let current = new Date(start);
      current.setDate(freq.dayOfMonth);
      if (current < start) current.setMonth(current.getMonth() + 1);
      while (current < endDate) {
        addEvent(current);
        const next = new Date(current);
        next.setMonth(next.getMonth() + 1);
        current = next;
      }
    }
  });

  // Fill in rest days
  let cursor = new Date(start);
  while (cursor < endDate) {
    const dateStr = format(cursor, 'yyyy-MM-dd');
    if (!scheduledDates.has(dateStr)) {
      workouts.push({
        programId: program.id,
        date: dateStr,
        templateId: 'rest',
        label: 'Rest Day',
      });
    }
    cursor = addDays(cursor, 1);
  }

  return workouts;
}

// Map DB row to app type
function mapSession(row: any): WorkoutSession {
  return {
    id: row.id,
    date: row.date,
    startedAt: row.started_at ?? undefined,
    exercises: row.exercises as any[],
    duration: row.duration,
    totalVolume: Number(row.total_volume),
    totalSets: row.total_sets,
    totalReps: row.total_reps,
    averageRpe: row.average_rpe ? Number(row.average_rpe) : undefined,
    note: row.note ?? undefined,
    isRestDay: row.is_rest_day ?? false,
    recoveryActivities: row.recovery_activities as any,
  };
}

function mapTemplate(row: any): WorkoutTemplate {
  return {
    id: row.id,
    name: row.name,
    exercises: row.exercises as any[],
  };
}

function mapProgram(row: any): WorkoutProgram {
  return {
    id: row.id,
    name: row.name,
    days: row.days as any[],
    durationWeeks: row.duration_weeks ?? 8,
    startDate: row.start_date ?? undefined,
    schedule: row.schedule as any,
  };
}

function mapFutureWorkout(row: any): FutureWorkout {
  return {
    id: row.id,
    programId: row.program_id,
    date: row.date,
    templateId: row.template_id,
    label: row.label,
    completed: row.completed ?? false,
    recoveryActivities: row.recovery_activities as any,
  };
}

export type WeightUnit = 'kg' | 'lbs';

export type StreakMode = 'daily' | 'weekly';

export interface UserPreferences {
  weightUnit: WeightUnit;
  defaultRestSeconds: number;
  defaultDropSetsEnabled: boolean;
  streakMode: StreakMode;
  streakWeeklyTarget: number;
  tutorialCompleted: boolean;
  hideTimers: boolean;
  customLocations: string[];
}

export interface UserProfile {
  displayName: string | null;
}

const DEFAULT_PREFERENCES: UserPreferences = { weightUnit: 'lbs', defaultRestSeconds: 90, defaultDropSetsEnabled: false, streakMode: 'daily', streakWeeklyTarget: 3, tutorialCompleted: false, hideTimers: false };
const DEFAULT_PROFILE: UserProfile = { displayName: null };

export function useStorage() {
  const { user } = useAuth();
  const [history, setHistory] = useState<WorkoutSession[]>([]);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [programs, setPrograms] = useState<WorkoutProgram[]>([]);
  const [activeProgramId, setActiveProgramIdState] = useState<string | null>(null);
  const [futureWorkouts, setFutureWorkouts] = useState<FutureWorkout[]>([]);
  const [preferences, setPreferencesState] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [profile, setProfileState] = useState<UserProfile>(DEFAULT_PROFILE);
  const [loading, setLoading] = useState(true);

  // Load all data from Supabase on mount / user change
  useEffect(() => {
    if (!user) {
      setHistory([]);
      setTemplates([]);
      setPrograms([]);
      setActiveProgramId(null);
      setFutureWorkouts([]);
      setLoading(false);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const [sessionsRes, templatesRes, programsRes, futureRes, settingsRes, profileRes] = await Promise.all([
          supabase.from('workout_sessions').select('*').eq('user_id', user.id).order('date', { ascending: false }),
          supabase.from('workout_templates').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
          supabase.from('workout_programs').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
          supabase.from('future_workouts').select('*').eq('user_id', user.id).order('date', { ascending: true }),
          supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
          supabase.from('profiles').select('*').eq('user_id', user.id).maybeSingle(),
        ]);

        if (sessionsRes.data) setHistory(sessionsRes.data.map(mapSession));
        if (templatesRes.data) setTemplates(templatesRes.data.map(mapTemplate));
        if (programsRes.data) setPrograms(programsRes.data.map(mapProgram));
        if (futureRes.data) setFutureWorkouts(futureRes.data.map(mapFutureWorkout));
        if (settingsRes.data) {
          setActiveProgramIdState(settingsRes.data.active_program_id);
          setPreferencesState({
            weightUnit: (settingsRes.data as any).weight_unit ?? 'lbs',
            defaultRestSeconds: (settingsRes.data as any).default_rest_seconds ?? 90,
            defaultDropSetsEnabled: (settingsRes.data as any).default_drop_sets_enabled ?? false,
            streakMode: ((settingsRes.data as any).streak_mode ?? 'daily') as StreakMode,
            streakWeeklyTarget: (settingsRes.data as any).streak_weekly_target ?? 3,
            tutorialCompleted: (settingsRes.data as any).tutorial_completed ?? false,
            hideTimers: (settingsRes.data as any).hide_timers ?? false,
          });
        }
        if (profileRes.data) {
          setProfileState({
            displayName: profileRes.data.display_name,
          });
        }
      } catch (e) {
        console.error('[useStorage] Failed to load data:', e);
        toast.error('Failed to load your data');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user]);

  const setActiveProgramId = useCallback((id: string | null) => {
    setActiveProgramIdState(id);
  }, []);

  const saveSession = useCallback(async (session: WorkoutSession) => {
    if (!user) return;
    const { error } = await supabase.from('workout_sessions').upsert({
      id: session.id,
      user_id: user.id,
      date: session.date,
      started_at: session.startedAt ?? null,
      exercises: session.exercises as any,
      duration: session.duration,
      total_volume: session.totalVolume,
      total_sets: session.totalSets,
      total_reps: session.totalReps,
      average_rpe: session.averageRpe ?? null,
      note: session.note ?? null,
      is_rest_day: session.isRestDay ?? false,
      recovery_activities: session.recoveryActivities as any ?? null,
    });
    if (error) {
      console.error('[useStorage] saveSession error:', error);
      toast.error('Failed to save workout session');
      return;
    }
    setHistory(prev => {
      const exists = prev.findIndex(s => s.id === session.id);
      if (exists >= 0) return prev.map(s => s.id === session.id ? session : s);
      return [session, ...prev];
    });
    // Clean future workouts that match this date
    setFutureWorkouts(prev => {
      const toRemove = prev.filter(fw => fw.date === session.date.split('T')[0] && !fw.completed);
      toRemove.forEach(fw => {
        supabase.from('future_workouts').delete().eq('id', fw.id).then(() => {});
      });
      return prev.filter(fw => !toRemove.some(r => r.id === fw.id));
    });
  }, [user]);

  const saveTemplate = useCallback(async (template: WorkoutTemplate) => {
    if (!user) return;
    const { error } = await supabase.from('workout_templates').upsert({
      id: template.id,
      user_id: user.id,
      name: template.name,
      exercises: template.exercises as any,
    });
    if (error) {
      console.error('[useStorage] saveTemplate error:', error);
      toast.error('Failed to save template');
      return;
    }
    setTemplates(prev => {
      const exists = prev.findIndex(t => t.id === template.id);
      if (exists >= 0) return prev.map(t => t.id === template.id ? template : t);
      return [...prev, template];
    });
  }, [user]);

  const deleteTemplate = useCallback(async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from('workout_templates').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      console.error('[useStorage] deleteTemplate error:', error);
      toast.error('Failed to delete template');
      return;
    }
    setTemplates(prev => prev.filter(t => t.id !== id));
  }, [user]);

  const saveProgram = useCallback(async (program: WorkoutProgram) => {
    if (!user) return;
    const { error } = await supabase.from('workout_programs').upsert({
      id: program.id,
      user_id: user.id,
      name: program.name,
      days: program.days as any,
      duration_weeks: program.durationWeeks ?? 8,
      start_date: program.startDate ?? null,
      schedule: program.schedule as any ?? null,
    });
    if (error) {
      console.error('[useStorage] saveProgram error:', error);
      toast.error('Failed to save program');
      return;
    }
    setPrograms(prev => {
      const exists = prev.findIndex(p => p.id === program.id);
      if (exists >= 0) return prev.map(p => p.id === program.id ? program : p);
      return [...prev, program];
    });

    // Regenerate future workouts for this program
    // Delete old ones for this program
    await supabase.from('future_workouts').delete().eq('program_id', program.id).eq('user_id', user.id);
    
    const newFws = generateFutureWorkouts(program);
    const today = format(new Date(), 'yyyy-MM-dd');
    const futureFws = newFws.filter(fw => fw.date >= today);
    
    if (futureFws.length > 0) {
      const rows = futureFws.map(fw => ({
        user_id: user.id,
        program_id: fw.programId,
        date: fw.date,
        template_id: fw.templateId,
        label: fw.label,
        completed: false,
      }));
      const { data, error: insertError } = await supabase.from('future_workouts').insert(rows).select();
      if (insertError) {
        console.error('[useStorage] future workouts insert error:', insertError);
      }
      if (data) {
        setFutureWorkouts(prev => {
          const withoutOld = prev.filter(fw => fw.programId !== program.id);
          return [...withoutOld, ...data.map(mapFutureWorkout)].sort((a, b) => a.date.localeCompare(b.date));
        });
      }
    } else {
      setFutureWorkouts(prev => prev.filter(fw => fw.programId !== program.id));
    }
  }, [user]);

  const deleteProgram = useCallback(async (id: string) => {
    if (!user) return;
    await supabase.from('future_workouts').delete().eq('program_id', id).eq('user_id', user.id);
    const { error } = await supabase.from('workout_programs').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      console.error('[useStorage] deleteProgram error:', error);
      toast.error('Failed to delete program');
      return;
    }
    setPrograms(prev => prev.filter(p => p.id !== id));
    setFutureWorkouts(prev => prev.filter(fw => fw.programId !== id));
  }, [user]);

  const setActiveProgram = useCallback(async (id: string | null) => {
    if (!user) return;
    setActiveProgramIdState(id);
    const { error } = await supabase.from('user_settings').upsert({
      user_id: user.id,
      active_program_id: id,
    }, { onConflict: 'user_id' });
    if (error) {
      console.error('[useStorage] setActiveProgram error:', error);
    }
  }, [user]);

  const deleteSession = useCallback(async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from('workout_sessions').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      console.error('[useStorage] deleteSession error:', error);
      toast.error('Failed to delete session');
      return;
    }
    setHistory(prev => prev.filter(s => s.id !== id));
  }, [user]);

  const updateFutureWorkout = useCallback(async (updated: FutureWorkout) => {
    if (!user) return;
    const { error } = await supabase.from('future_workouts').upsert({
      id: updated.id,
      user_id: user.id,
      program_id: updated.programId,
      date: updated.date,
      template_id: updated.templateId,
      label: updated.label,
      completed: updated.completed ?? false,
      recovery_activities: updated.recoveryActivities as any ?? null,
    });
    if (error) {
      console.error('[useStorage] updateFutureWorkout error:', error);
      toast.error('Failed to update future workout');
      return;
    }
    setFutureWorkouts(prev => {
      const exists = prev.some(fw => fw.id === updated.id);
      if (exists) return prev.map(fw => fw.id === updated.id ? updated : fw);
      return [...prev, updated];
    });
  }, [user]);

  const deleteFutureWorkout = useCallback(async (id: string) => {
    if (!user) return;
    const { error } = await supabase.from('future_workouts').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      console.error('[useStorage] deleteFutureWorkout error:', error);
      toast.error('Failed to delete scheduled workout');
      return;
    }
    setFutureWorkouts(prev => prev.filter(fw => fw.id !== id));
  }, [user]);

  const pushProgramBack = useCallback(async (programId: string, fromDate: string, days: number) => {
    if (!user || days <= 0) return;
    const targets = futureWorkouts.filter(fw => fw.programId === programId && fw.date >= fromDate);
    if (targets.length === 0) return;
    const updates = targets.map(fw => {
      const d = parseLocalDate(fw.date);
      d.setDate(d.getDate() + days);
      const newDate = format(d, 'yyyy-MM-dd');
      return { ...fw, date: newDate };
    });
    const results = await Promise.all(updates.map(u =>
      supabase.from('future_workouts').update({ date: u.date }).eq('id', u.id).eq('user_id', user.id)
    ));
    const failed = results.find(r => r.error);
    if (failed?.error) {
      console.error('[useStorage] pushProgramBack error:', failed.error);
      toast.error('Failed to shift program dates');
      return;
    }
    setFutureWorkouts(prev => {
      const map = new Map(updates.map(u => [u.id, u.date]));
      return prev.map(fw => map.has(fw.id) ? { ...fw, date: map.get(fw.id)! } : fw)
        .sort((a, b) => a.date.localeCompare(b.date));
    });

    // Also shift the program's startDate and frequency startDates
    const program = programs.find(p => p.id === programId);
    if (program) {
      const shiftDate = (dateStr: string | undefined): string | undefined => {
        if (!dateStr) return dateStr;
        const d = parseLocalDate(dateStr);
        d.setDate(d.getDate() + days);
        return format(d, 'yyyy-MM-dd');
      };
      const updatedProgram: WorkoutProgram = {
        ...program,
        startDate: shiftDate(program.startDate),
        days: program.days.map(day => ({
          ...day,
          frequency: day.frequency && day.frequency.type === 'everyNDays' && day.frequency.startDate
            ? { ...day.frequency, startDate: shiftDate(day.frequency.startDate) }
            : day.frequency,
        })),
      };
      await supabase.from('workout_programs').update({
        start_date: updatedProgram.startDate ?? null,
        days: updatedProgram.days as any,
      }).eq('id', programId).eq('user_id', user.id);
      setPrograms(prev => prev.map(p => p.id === programId ? updatedProgram : p));
    }

    toast.success(`Shifted ${updates.length} workout${updates.length === 1 ? '' : 's'} forward by ${days} day${days === 1 ? '' : 's'}`);
  }, [user, futureWorkouts, programs]);

  const updatePreferences = useCallback(async (prefs: Partial<UserPreferences>) => {
    if (!user) return;
    const updated = { ...preferences, ...prefs };
    setPreferencesState(updated);
    const { error } = await supabase.from('user_settings').upsert({
      user_id: user.id,
      active_program_id: activeProgramId,
      weight_unit: updated.weightUnit,
      default_rest_seconds: updated.defaultRestSeconds,
      default_drop_sets_enabled: updated.defaultDropSetsEnabled,
      streak_mode: updated.streakMode,
      streak_weekly_target: updated.streakWeeklyTarget,
      tutorial_completed: updated.tutorialCompleted,
      hide_timers: updated.hideTimers,
    } as any, { onConflict: 'user_id' });
    if (error) {
      console.error('[useStorage] updatePreferences error:', error);
      toast.error('Failed to save preferences');
    }
  }, [user, preferences, activeProgramId]);

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    if (!user) return;
    const updated = { ...profile, ...updates };
    setProfileState(updated);
    const { error } = await supabase.from('profiles').upsert({
      user_id: user.id,
      display_name: updated.displayName,
    }, { onConflict: 'user_id' });
    if (error) {
      console.error('[useStorage] updateProfile error:', error);
      toast.error('Failed to save profile');
    }
  }, [user, profile]);

  return {
    history, templates, programs, activeProgramId, futureWorkouts, preferences, profile, loading,
    saveSession, saveTemplate, deleteTemplate,
    saveProgram, deleteProgram, setActiveProgram, deleteSession, updateFutureWorkout,
    deleteFutureWorkout, pushProgramBack, updatePreferences,
    updateProfile,
  };
}
