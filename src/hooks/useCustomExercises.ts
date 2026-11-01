import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useCoach } from '@/contexts/CoachContext';
import { toast } from 'sonner';
import type { Exercise, MeasurementType } from '@/data/exercises';
import type { Database } from '@/integrations/supabase/types';

// measurement_type is a column that exists in the DB but isn't in the
// current generated types. Extend the Insert/Update shapes locally so
// callers don't need `as any`.
type CustomExerciseInsertExtended =
  Database['public']['Tables']['custom_exercises']['Insert'] & { measurement_type?: MeasurementType | null };
type CustomExerciseUpdateExtended =
  Database['public']['Tables']['custom_exercises']['Update'] & { measurement_type?: MeasurementType | null };

/** A custom exercise as the app consumes it, after row -> Exercise mapping. */
export type CustomExercise = Exercise & {
  isCustom: true;
  isRecovery: boolean;
  excludeFromVolume: boolean;
};

export interface CustomExerciseInput {
  name: string;
  primaryBodyPart: string;
  equipment: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  exerciseType: 'Compound' | 'Isolation';
  movementPattern: string;
  secondaryMuscles: string[];
  isRecovery: boolean;
  excludeFromVolume: boolean;
  measurementType?: MeasurementType | null;
}

export function useCustomExercises() {
  // The library being shown: the signed-in user's, or the client's a coach is
  // acting as. Keyed on the id, not the user object — see AuthContext. A token
  // refresh used to recreate this callback and refetch the whole list.
  const { ownerId: userId } = useCoach();
  const [exercises, setExercises] = useState<CustomExercise[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchExercises = useCallback(async () => {
    if (!userId) { setExercises([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('custom_exercises')
      .select('*')
      // Never RLS alone: a coach's RLS reaches every client's library too, and
      // without this the coach's own picker would list all of them.
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) { console.error(error); setLoading(false); return; }
    setExercises((data ?? []).map(row => ({
      id: `custom-${row.id}`,
      name: row.name,
      primaryBodyPart: row.primary_body_part,
      equipment: row.equipment,
      difficulty: row.difficulty as Exercise['difficulty'],
      exerciseType: row.exercise_type as Exercise['exerciseType'],
      movementPattern: row.movement_pattern,
      secondaryMuscles: (row.secondary_muscles as string[]) ?? [],
      // measurement_type isn't in the generated Database Row type yet; read
      // it via a narrowed access instead of an `as any` cast.
      measurementType: (row as { measurement_type?: MeasurementType | null }).measurement_type ?? undefined,
      isCustom: true as const,
      isRecovery: row.is_recovery,
      excludeFromVolume: row.exclude_from_volume,
    })));
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchExercises(); }, [fetchExercises]);

  const addExercise = useCallback(async (input: CustomExerciseInput) => {
    if (!userId) return;
    const payload: CustomExerciseInsertExtended = {
      user_id: userId,
      name: input.name,
      primary_body_part: input.primaryBodyPart,
      equipment: input.equipment,
      difficulty: input.difficulty,
      exercise_type: input.exerciseType,
      movement_pattern: input.movementPattern,
      secondary_muscles: input.secondaryMuscles,
      is_recovery: input.isRecovery,
      exclude_from_volume: input.excludeFromVolume,
      measurement_type: input.measurementType ?? null,
    };
    const { error } = await supabase
      .from('custom_exercises')
      .insert(payload as Database['public']['Tables']['custom_exercises']['Insert']);
    if (error) { toast.error('Failed to save exercise'); return; }
    toast.success(`Exercise "${input.name}" saved.`);
    fetchExercises();
  }, [userId, fetchExercises]);

  const deleteExercise = useCallback(async (customId: string) => {
    if (!userId) return;
    const dbId = customId.replace('custom-', '');
    // Scoped to the owner, and checked: a refusal under RLS removes nothing and
    // reports no error, which must not read as a deletion.
    const { data, error } = await supabase
      .from('custom_exercises').delete().eq('id', dbId).eq('user_id', userId).select('id');
    if (error || !data?.length) { toast.error('Failed to delete exercise'); return; }
    toast.success('Exercise deleted');
    fetchExercises();
  }, [userId, fetchExercises]);

  const updateExercise = useCallback(async (customId: string, input: CustomExerciseInput) => {
    if (!userId) return;
    const dbId = customId.replace('custom-', '');
    const patch: CustomExerciseUpdateExtended = {
      name: input.name,
      primary_body_part: input.primaryBodyPart,
      equipment: input.equipment,
      difficulty: input.difficulty,
      exercise_type: input.exerciseType,
      movement_pattern: input.movementPattern,
      secondary_muscles: input.secondaryMuscles,
      is_recovery: input.isRecovery,
      exclude_from_volume: input.excludeFromVolume,
      measurement_type: input.measurementType ?? null,
    };
    const { data, error } = await supabase
      .from('custom_exercises')
      .update(patch as Database['public']['Tables']['custom_exercises']['Update'])
      .eq('id', dbId)
      .eq('user_id', userId)
      .select('id');
    if (error || !data?.length) { toast.error('Failed to update exercise'); return; }
    toast.success(`Exercise "${input.name}" updated.`);
    fetchExercises();
  }, [userId, fetchExercises]);

  return { exercises, loading, addExercise, deleteExercise, updateExercise, refetch: fetchExercises };
}
