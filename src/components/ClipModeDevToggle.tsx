import React from 'react';
import { FlaskConical } from 'lucide-react';
import {
  CLIP_MODE,
  CLIP_MODE_OVERRIDE_ENABLED,
  getClipModeOverride,
  setClipModeOverride,
  useClipMode,
  type ClipMode,
} from '@/config/exerciseClips';
import { cn } from '@/lib/utils';

const OPTIONS: { value: ClipMode | null; label: string }[] = [
  { value: null, label: `Default (${CLIP_MODE})` },
  { value: 'opaque', label: 'Opaque .mp4' },
  { value: 'alpha', label: 'Alpha .webm' },
];

/**
 * Settings → Developer. Renders nothing in a production build, where the
 * override is compiled out (CLIP_MODE_OVERRIDE_ENABLED).
 */
export const ClipModeDevToggle: React.FC = () => {
  const effective = useClipMode();
  if (!CLIP_MODE_OVERRIDE_ENABLED) return null;
  const override = getClipModeOverride();

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden" data-testid="clip-mode-dev-toggle">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 text-primary" />
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Developer</p>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground">Exercise clip mode</span>
          <span className="text-xs font-mono text-muted-foreground">{effective}</span>
        </div>
        <div className="flex gap-2" role="radiogroup" aria-label="Exercise clip mode">
          {OPTIONS.map(option => {
            const selected = override === option.value;
            return (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setClipModeOverride(option.value)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  selected
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-secondary border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Dev builds only. Also set by ?clipmode=alpha, ?clipmode=opaque or ?clipmode=reset on the page URL.
        </p>
      </div>
    </div>
  );
};
