import React, { useEffect, useState } from 'react';
import { useClipMode, type ClipMode } from '@/config/exerciseClips';
import type { ExerciseClipAsset } from '@/hooks/useExerciseClip';
import { cn } from '@/lib/utils';

interface ExerciseClipProps {
  clip: ExerciseClipAsset;
  /** Exercise name, for the accessible label. */
  name: string;
  /** Overrides the app-wide mode; for previews and tests. */
  mode?: ClipMode;
  className?: string;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true,
  );
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED_MOTION_QUERY);
    if (!query?.addEventListener) return;
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// React sets `muted` as a property only. Reflecting the attribute as well
// keeps autoplay policy happy in WebViews that check it at parse time.
function applyMuted(el: HTMLVideoElement | null) {
  if (!el) return;
  el.muted = true;
  el.defaultMuted = true;
}

/**
 * Looping, muted, inline demonstration clip.
 *
 * One explicit source per CLIP_MODE, never two <source> elements: a browser
 * can decode VP9 and still drop the alpha channel, which is an opaque black
 * box with no error to fall back from. The box is reserved from the row's
 * pixel size before anything loads, so the detail screen never reflows; the
 * poster covers the load, reduced-motion, and any media error.
 */
export const ExerciseClip: React.FC<ExerciseClipProps> = ({ clip, name, mode: modeProp, className }) => {
  const appMode = useClipMode();
  const mode = modeProp ?? appMode;
  const reducedMotion = usePrefersReducedMotion();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedPoster, setFailedPoster] = useState<string | null>(null);

  const src = mode === 'alpha' ? clip.webmUrl : clip.mp4Url;
  const videoFailed = failedSrc === src;
  const posterFailed = failedPoster === clip.posterUrl;
  const label = `${name} demonstration`;

  return (
    <div
      data-testid="exercise-clip"
      data-clip-mode={mode}
      className={cn(
        'relative w-full overflow-hidden rounded-xl',
        // Opaque clips carry a baked white background, so the card is white
        // on purpose in every theme; alpha clips sit on whatever is behind them.
        mode === 'opaque' ? 'bg-white' : 'bg-transparent',
        className,
      )}
      style={{ aspectRatio: `${clip.width} / ${clip.height}` }}
    >
      {!reducedMotion && !videoFailed ? (
        <video
          key={src}
          ref={applyMuted}
          src={src}
          poster={posterFailed ? undefined : clip.posterUrl}
          autoPlay
          loop
          muted
          playsInline
          disablePictureInPicture
          preload="auto"
          aria-label={label}
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : !posterFailed ? (
        <img
          src={clip.posterUrl}
          alt={label}
          draggable={false}
          onError={() => setFailedPoster(clip.posterUrl)}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : null}
    </div>
  );
};
