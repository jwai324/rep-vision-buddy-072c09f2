import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EXERCISE_DATABASE, BODY_PARTS, getBodyPartIcon } from '@/data/exercises';
import type { ExerciseId } from '@/types/workout';

interface ExerciseSelectorProps {
  onSelect: (id: ExerciseId) => void;
  onStartTemplate?: () => void;
}

export const ExerciseSelector: React.FC<ExerciseSelectorProps> = ({ onSelect, onStartTemplate }) => {
  const [search, setSearch] = useState('');
  const [bodyPartFilter, setBodyPartFilter] = useState<string>('All');

  const filtered = useMemo(() => {
    return EXERCISE_DATABASE.filter(ex => {
      const matchesSearch = search === '' ||
        ex.name.toLowerCase().includes(search.toLowerCase()) ||
        ex.primaryBodyPart.toLowerCase().includes(search.toLowerCase()) ||
        ex.equipment.toLowerCase().includes(search.toLowerCase());
      const matchesBodyPart = bodyPartFilter === 'All' || ex.primaryBodyPart === bodyPartFilter;
      return matchesSearch && matchesBodyPart;
    });
  }, [search, bodyPartFilter]);

  // Group by body part
  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const ex of filtered) {
      if (!groups[ex.primaryBodyPart]) groups[ex.primaryBodyPart] = [];
      groups[ex.primaryBodyPart].push(ex);
    }
    return groups;
  }, [filtered]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2">
        <h2 className="text-xl font-bold text-foreground mb-3">Add Exercise</h2>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search exercises..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-secondary border-border"
          />
        </div>
        {/* Body part filter chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-2 scrollbar-hide">
          {BODY_PARTS.map(bp => (
            <button
              key={bp}
              onClick={() => setBodyPartFilter(bp)}
              className={`whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                bodyPartFilter === bp
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {bp}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-4 pb-4">
          {Object.entries(grouped).map(([bodyPart, exercises]) => (
            <div key={bodyPart}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <span>{getBodyPartIcon(bodyPart)}</span>
                {bodyPart}
                <span className="text-muted-foreground/50">({exercises.length})</span>
              </h3>
              <div className="space-y-0.5">
                {exercises.map(ex => (
                  <button
                    key={ex.id}
                    onClick={() => onSelect(ex.id)}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-secondary/80 transition-colors flex items-center justify-between group"
                  >
                    <div>
                      <span className="text-sm font-medium text-foreground">{ex.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{ex.equipment}</span>
                        <span className="text-xs text-muted-foreground/50">·</span>
                        <span className={`text-xs ${
                          ex.difficulty === 'Beginner' ? 'text-green-400' :
                          ex.difficulty === 'Intermediate' ? 'text-yellow-400' : 'text-red-400'
                        }`}>{ex.difficulty}</span>
                      </div>
                    </div>
                    <span className="text-primary opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium">
                      + Add
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No exercises found for "{search}"
            </div>
          )}

          {onStartTemplate && (
            <button
              onClick={onStartTemplate}
              className="w-full px-3 py-3 rounded-lg border border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors flex items-center gap-2"
            >
              <span className="text-lg">📋</span>
              <span className="text-sm font-medium text-muted-foreground">Start from Template</span>
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
