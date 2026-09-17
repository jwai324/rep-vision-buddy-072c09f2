import React, { useEffect, useState, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

interface ExerciseAnimationProps {
  exerciseName: string;
  movementPattern?: string;
}

const cache = new Map<string, string | null>();

export const ExerciseAnimation: React.FC<ExerciseAnimationProps> = ({ exerciseName, movementPattern }) => {
  const [gifUrl, setGifUrl] = useState<string | null | undefined>(undefined);
  const fetchedRef = useRef<string>('');

  useEffect(() => {
    if (!exerciseName || fetchedRef.current === exerciseName) return;
    fetchedRef.current = exerciseName;

    if (cache.has(exerciseName)) {
      setGifUrl(cache.get(exerciseName)!);
      return;
    }

    // The lookup goes through the exercise-gif edge function, which holds the
    // RapidAPI key as a function secret. It used to be read here from a VITE_
    // variable, and Vite inlines those into the public bundle.
    setGifUrl(undefined);
    supabase.functions
      .invoke<{ gifUrl?: string | null }>('exercise-gif', { body: { name: exerciseName } })
      .then(({ data, error }) => {
        const url = !error && typeof data?.gifUrl === 'string' ? data.gifUrl : null;
        cache.set(exerciseName, url);
        setGifUrl(url);
      })
      .catch(() => {
        cache.set(exerciseName, null);
        setGifUrl(null);
      });
  }, [exerciseName]);

  if (gifUrl === undefined) {
    return <Skeleton className="w-[200px] h-[200px] rounded-xl mx-auto" />;
  }

  if (!gifUrl) {
    return (
      <div className="w-[200px] h-[200px] rounded-xl bg-secondary flex items-center justify-center mx-auto">
        <span className="text-sm text-muted-foreground text-center px-4">
          {movementPattern || exerciseName}
        </span>
      </div>
    );
  }

  return (
    <img
      src={gifUrl}
      alt={`${exerciseName} animation`}
      className="w-[200px] h-[200px] object-contain rounded-xl mx-auto"
    />
  );
};
