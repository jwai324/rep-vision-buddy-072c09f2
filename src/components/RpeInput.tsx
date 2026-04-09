import React from 'react';

const RPE_LABELS: Record<number, string> = {
  1: 'Very Easy',
  2: 'Easy',
  3: 'Light',
  4: 'Moderate',
  5: 'Challenging',
  6: 'Hard',
  7: 'Very Hard',
  8: 'Intense',
  9: 'Near Max',
  10: 'Max Effort',
};

interface RpeInputProps {
  value: number | undefined;
  onChange: (value: number) => void;
}

export const RpeInput: React.FC<RpeInputProps> = ({ value, onChange }) => {
  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">RPE (optional)</span>
        {value && (
          <span className="text-sm font-medium text-primary">
            {value} — {RPE_LABELS[value]}
          </span>
        )}
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${
              value === n
                ? 'bg-primary text-primary-foreground glow-green'
                : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
};
