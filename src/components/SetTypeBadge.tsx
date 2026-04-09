import React from 'react';
import type { SetType } from '@/types/workout';
import { SET_TYPE_CONFIG } from '@/types/workout';

interface SetTypeBadgeProps {
  type: SetType;
  selected?: boolean;
  onClick?: () => void;
}

export const SetTypeBadge: React.FC<SetTypeBadgeProps> = ({ type, selected, onClick }) => {
  const config = SET_TYPE_CONFIG[type];
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${config.colorClass} ${
        selected
          ? 'ring-2 ring-primary ring-offset-2 ring-offset-background opacity-100'
          : 'opacity-60 hover:opacity-80'
      } text-foreground`}
    >
      {config.label}
    </button>
  );
};
