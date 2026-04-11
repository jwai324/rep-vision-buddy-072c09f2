import React, { useEffect, useState, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

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

    const apiKey = import.meta.env.VITE_EXERCISE_GIF_API;
    if (!apiKey) {
      cache.set(exerciseName, null);
      setGifUrl(null);
      return;
    }

    setGifUrl(undefined);
    fetch(
      `https://workoutx-exercise-api-with-gif-animations.p.rapidapi.com/exercises/search?name=${encodeURIComponent(exerciseName)}`,
      {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'workoutx-exercise-api-with-gif-animations.p.rapidapi.com',
        },
      }
    )
      .then(res => res.json())
      .then(data => {
        const url = data?.data?.[0]?.gifUrl ?? null;
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
