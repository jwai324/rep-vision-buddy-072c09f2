import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import type { Exercise, MeasurementType } from '@/data/exercises';

export interface CustomExerciseInput {
  name: string;
  primaryBodyPart: string;
  equipment: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  exerciseType: 'Compound' | 'Isolation';
  movementPattern: string;
  secondaryMuscles: string[];
  isRecovery: boolean;
  measurementType?: MeasurementType | null;
}

export function useCustomExercises() {
  const { user } = useAuth();
  const [exercises, setExercises] = useState<(Exercise & { isCustom: true; isRecovery: boolean })[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchExercises = useCallback(async () => {
    if (!user) { setExercises([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('custom_exercises')
      .select('*')
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
      measurementType: (row as any).measurement_type as MeasurementType | undefined,
      isCustom: true as const,
      isRecovery: row.is_recovery,
    })));
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchExercises(); }, [fetchExercises]);

  const addExercise = useCallback(async (input: CustomExerciseInput) => {
    if (!user) return;
    const { error } = await supabase.from('custom_exercises').insert({
      user_id: user.id,
      name: input.name,
      primary_body_part: input.primaryBodyPart,
      equipment: input.equipment,
      difficulty: input.difficulty,
      exercise_type: input.exerciseType,
      movement_pattern: input.movementPattern,
      secondary_muscles: input.secondaryMuscles as any,
      is_recovery: input.isRecovery,
    });
    if (error) { toast.error('Failed to save exercise'); return; }
    toast.success('Exercise created');
    fetchExercises();
  }, [user, fetchExercises]);

  const deleteExercise = useCallback(async (customId: string) => {
    if (!user) return;
    const dbId = customId.replace('custom-', '');
    const { error } = await supabase.from('custom_exercises').delete().eq('id', dbId);
    if (error) { toast.error('Failed to delete exercise'); return; }
    toast.success('Exercise deleted');
    fetchExercises();
  }, [user, fetchExercises]);

  const updateExercise = useCallback(async (customId: string, input: CustomExerciseInput) => {
    if (!user) return;
    const dbId = customId.replace('custom-', '');
    const { error } = await supabase.from('custom_exercises').update({
      name: input.name,
      primary_body_part: input.primaryBodyPart,
      equipment: input.equipment,
      difficulty: input.difficulty,
      exercise_type: input.exerciseType,
      movement_pattern: input.movementPattern,
      secondary_muscles: input.secondaryMuscles as any,
      is_recovery: input.isRecovery,
    }).eq('id', dbId);
    if (error) { toast.error('Failed to update exercise'); return; }
    toast.success('Exercise updated');
    fetchExercises();
  }, [user, fetchExercises]);

  return { exercises, loading, addExercise, deleteExercise, updateExercise, refetch: fetchExercises };
}
