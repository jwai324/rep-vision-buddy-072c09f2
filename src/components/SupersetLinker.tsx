import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Check } from 'lucide-react';

interface ExerciseItem {
  exerciseId: string;
  exerciseName: string;
  supersetGroup?: number;
}

interface SupersetLinkerProps {
  exercises: ExerciseItem[];
  onSave: (groups: Record<string, number | undefined>) => void;
  onCancel: () => void;
}

const SUPERSET_COLORS = [
  'bg-red-500/20 border-red-500',
  'bg-blue-500/20 border-blue-500',
  'bg-green-500/20 border-green-500',
  'bg-yellow-500/20 border-yellow-500',
  'bg-pink-500/20 border-pink-500',
  'bg-orange-500/20 border-orange-500',
  'bg-amber-800/20 border-amber-800',
  'bg-purple-500/20 border-purple-500',
  'bg-white/20 border-white',
];

export const SupersetLinker: React.FC<SupersetLinkerProps> = ({ exercises, onSave, onCancel }) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [groups, setGroups] = useState<Record<string, number | undefined>>(() => {
    const g: Record<string, number | undefined> = {};
    exercises.forEach(e => { g[e.exerciseId] = e.supersetGroup; });
    return g;
  });

  const nextGroupId = () => {
    const existing = Object.values(groups).filter((v): v is number => v !== undefined);
    return existing.length > 0 ? Math.max(...existing) + 1 : 1;
  };

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const linkSelected = () => {
    if (selected.size < 2) return;
    const groupId = nextGroupId();
    const newGroups = { ...groups };
    selected.forEach(idx => {
      newGroups[exercises[idx].exerciseId] = groupId;
    });
    setGroups(newGroups);
    setSelected(new Set());
  };

  const unlinkExercise = (exerciseId: string) => {
    setGroups(prev => ({ ...prev, [exerciseId]: undefined }));
  };

  const getColorClass = (groupId: number | undefined) => {
    if (groupId === undefined) return '';
    return SUPERSET_COLORS[(groupId - 1) % SUPERSET_COLORS.length];
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between p-4">
        <Button variant="outline" size="sm" onClick={onCancel}>← Back</Button>
        <Button variant="neon" size="sm" onClick={() => onSave(groups)}>Save</Button>
      </div>

      <div className="px-4 pb-3">
        <h1 className="text-xl font-bold text-foreground">Link Supersets</h1>
        <p className="text-sm text-muted-foreground">Select 2+ exercises then tap "Link" to superset them.</p>
      </div>

      <div className="flex-1 px-4 space-y-2 pb-24">
        {exercises.map((ex, idx) => {
          const isSelected = selected.has(idx);
          const groupId = groups[ex.exerciseId];
          const colorClass = getColorClass(groupId);

          return (
            <button
              key={ex.exerciseId}
              onClick={() => toggleSelect(idx)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                isSelected
                  ? 'border-primary bg-primary/10'
                  : colorClass
                    ? `border ${colorClass}`
                    : 'border-border bg-card'
              }`}
            >
              <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${
                isSelected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}>
                {isSelected && <Check className="w-4 h-4" />}
              </div>
              <div className="flex-1">
                <span className="text-sm font-medium text-foreground">{ex.exerciseName}</span>
                {groupId !== undefined && (
                  <span className="ml-2 text-xs text-muted-foreground">Group {groupId}</span>
                )}
              </div>
              {groupId !== undefined && (
                <button
                  onClick={e => { e.stopPropagation(); unlinkExercise(ex.exerciseId); }}
                  className="text-xs text-destructive hover:underline"
                >
                  Unlink
                </button>
              )}
            </button>
          );
        })}
      </div>

      {selected.size >= 2 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur border-t border-border">
          <Button variant="neon" className="w-full" onClick={linkSelected}>
            Link {selected.size} Exercises as Superset
          </Button>
        </div>
      )}
    </div>
  );
};
