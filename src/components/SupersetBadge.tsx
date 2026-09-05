import React from 'react';
import { supersetDotClass, supersetLabel } from '@/types/activeSession';

interface SupersetBadgeProps {
  group: number;
  /** Opens the superset linker. Omitted where the link is read-only. */
  onClick?: () => void;
}

/**
 * Names the superset a card belongs to. The shared tint alone says "these two
 * are the same colour"; the badge says which pairing that is, which is what
 * makes a workout of three back-to-back pairs readable. Used by the live
 * session and the template builder alike so the two look the same.
 */
export const SupersetBadge: React.FC<SupersetBadgeProps> = ({ group, onClick }) => {
  const content = (
    <>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${supersetDotClass(group)}`} />
      Superset {supersetLabel(group)}
    </>
  );
  const className = 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-background/60 text-[10px] font-bold uppercase tracking-wider text-foreground';
  if (!onClick) return <span className={className}>{content}</span>;
  return (
    <button type="button" onClick={onClick} className={`${className} hover:bg-background/90 transition-colors`}>
      {content}
    </button>
  );
};
