import React from 'react';
import type { SupersetInfo } from '@/types/activeSession';

interface SupersetBadgeProps {
  info: SupersetInfo;
  /** Opens the superset linker. Omitted where the link is read-only. */
  onClick?: () => void;
}

/**
 * Names the superset a card belongs to and how big it is. The shared tint
 * alone says "these two are the same colour"; the badge says which pairing
 * that is and how many exercises it links, which is what makes a workout of
 * three back-to-back pairs readable. Used by the live session and the
 * template builder alike so the two look the same.
 */
export const SupersetBadge: React.FC<SupersetBadgeProps> = ({ info, onClick }) => {
  const content = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${info.dotClass}`} />
      Superset {info.letter} · {info.position} of {info.size}
    </>
  );
  const className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/60 text-[10px] font-bold uppercase tracking-wider text-foreground';
  if (!onClick) return <span data-testid="superset-badge" className={className}>{content}</span>;
  return (
    <button type="button" data-testid="superset-badge" onClick={onClick} className={`${className} hover:bg-background/90 transition-colors`}>
      {content}
    </button>
  );
};
