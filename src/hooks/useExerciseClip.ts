import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { CLIP_BUCKET } from '@/config/exerciseClips';
import type { Database } from '@/integrations/supabase/types';

const CLIP_COLUMNS = 'exercise_id, webm_path, mp4_path, poster_path, width, height, duration_ms';

type ClipRow = Pick<
  Database['public']['Tables']['exercise_clips']['Row'],
  'exercise_id' | 'webm_path' | 'mp4_path' | 'poster_path' | 'width' | 'height' | 'duration_ms'
>;

/** A clip as the app consumes it: resolved public URLs plus the box to reserve. */
export interface ExerciseClipAsset {
  exerciseId: string;
  webmUrl: string;
  mp4Url: string;
  posterUrl: string;
  width: number;
  height: number;
  durationMs: number;
}

export function clipAssetFromRow(row: ClipRow): ExerciseClipAsset {
  const url = (path: string) => supabase.storage.from(CLIP_BUCKET).getPublicUrl(path).data.publicUrl;
  return {
    exerciseId: row.exercise_id,
    webmUrl: url(row.webm_path),
    mp4Url: url(row.mp4_path),
    posterUrl: url(row.poster_path),
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
  };
}

// Reference data: one row per exercise that changes when the library is
// re-ingested, not mid-session, so a lookup is done once per app load and
// shared by every screen. A failed lookup is not cached; the next open retries.
const cache = new Map<string, ExerciseClipAsset | null>();
const inFlight = new Map<string, Promise<ExerciseClipAsset | null>>();

export async function fetchExerciseClip(exerciseId: string): Promise<ExerciseClipAsset | null> {
  const cached = cache.get(exerciseId);
  if (cached !== undefined) return cached;
  let pending = inFlight.get(exerciseId);
  if (!pending) {
    pending = (async () => {
      const { data, error } = await supabase
        .from('exercise_clips')
        .select(CLIP_COLUMNS)
        .eq('exercise_id', exerciseId)
        .maybeSingle();
      if (error) throw error;
      const asset = data ? clipAssetFromRow(data) : null;
      cache.set(exerciseId, asset);
      return asset;
    })().finally(() => inFlight.delete(exerciseId));
    inFlight.set(exerciseId, pending);
  }
  return pending;
}

interface ClipState {
  id: string | null;
  clip: ExerciseClipAsset | null;
  loading: boolean;
}

function stateFor(exerciseId: string | null): ClipState {
  const hit = exerciseId ? cache.get(exerciseId) : null;
  return { id: exerciseId, clip: hit ?? null, loading: !!exerciseId && hit === undefined };
}

/**
 * The clip for an exercise, or null once it is known there is none.
 * `loading` is true only while the row is being looked up for the first time.
 */
export function useExerciseClip(exerciseId: string | null): { clip: ExerciseClipAsset | null; loading: boolean } {
  const [state, setState] = useState<ClipState>(() => stateFor(exerciseId));

  useEffect(() => {
    const initial = stateFor(exerciseId);
    setState(initial);
    if (!exerciseId || !initial.loading) return;
    let cancelled = false;
    fetchExerciseClip(exerciseId)
      .then(clip => {
        if (!cancelled) setState({ id: exerciseId, clip, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ id: exerciseId, clip: null, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [exerciseId]);

  // The detail modal is reused across exercises: never show one exercise's
  // clip under another's name during the render before the effect catches up.
  const current = state.id === exerciseId ? state : stateFor(exerciseId);
  return { clip: current.clip, loading: current.loading };
}
