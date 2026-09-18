import React, { useEffect, useState, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';

interface ExerciseAnimationProps {
  exerciseName: string;
  movementPattern?: string;
}

// Answers the server actually gave. A failed call is not cached, so a
// transient error (a token refresh racing the call, a 5xx, the minute after a
// deploy) does not pin an exercise to "no clip" for the rest of the page.
const cache = new Map<string, string | null>();
// Set once the function says no key is configured: the feature is off and
// every further lookup would be a round trip for the same answer.
let featureOff = false;

export const ExerciseAnimation: React.FC<ExerciseAnimationProps> = ({ exerciseName, movementPattern }) => {
  const [gifUrl, setGifUrl] = useState<string | null | undefined>(undefined);
  const fetchedRef = useRef<string>('');

  useEffect(() => {
    if (!exerciseName || fetchedRef.current === exerciseName) return;
    fetchedRef.current = exerciseName;

    if (featureOff) {
      setGifUrl(null);
      return;
    }
    if (cache.has(exerciseName)) {
      setGifUrl(cache.get(exerciseName)!);
      return;
    }

    // The lookup goes through the exercise-gif edge function, which holds the
    // RapidAPI key as a function secret. It used to be read here from a VITE_
    // variable, and Vite inlines those into the public bundle.
    setGifUrl(undefined);
    supabase.functions
      .invoke<{ gifUrl?: string | null; enabled?: boolean }>('exercise-gif', { body: { name: exerciseName } })
      .then(({ data, error }) => {
        if (error || !data) {
          fetchedRef.current = '';
          setGifUrl(null);
          return;
        }
        if (data.enabled === false) featureOff = true;
        const url = typeof data.gifUrl === 'string' ? data.gifUrl : null;
        cache.set(exerciseName, url);
        setGifUrl(url);
      })
      .catch(() => {
        fetchedRef.current = '';
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
