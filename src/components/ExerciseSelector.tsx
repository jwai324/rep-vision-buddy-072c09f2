import React, { useState, useMemo } from 'react';
import { Search, Filter, X, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { EXERCISE_DATABASE, BODY_PARTS, EQUIPMENT_LIST, getBodyPartIcon } from '@/data/exercises';
import type { ExerciseId } from '@/types/workout';

interface ExerciseSelectorProps {
  onSelect: (id: ExerciseId) => void;
  onSelectMultiple?: (ids: ExerciseId[]) => void;
  onStartTemplate?: () => void;
  multiSelect?: boolean;
  browseMode?: boolean;
  onExerciseTap?: (id: ExerciseId) => void;
}

const DIFFICULTIES = ['All', 'Beginner', 'Intermediate', 'Advanced'] as const;
const EXERCISE_TYPES = ['All', 'Compound', 'Isolation'] as const;

export const ExerciseSelector: React.FC<ExerciseSelectorProps> = ({ onSelect, onSelectMultiple, onStartTemplate, multiSelect = true }) => {
  const [search, setSearch] = useState('');
  const [bodyPartFilter, setBodyPartFilter] = useState<string>('All');
  const [equipmentFilter, setEquipmentFilter] = useState<string>('All');
  const [difficultyFilter, setDifficultyFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<ExerciseId>>(new Set());

  const activeFilterCount = [equipmentFilter, difficultyFilter, typeFilter].filter(f => f !== 'All').length + (bodyPartFilter !== 'All' ? 1 : 0);

  const filtered = useMemo(() => {
    return EXERCISE_DATABASE.filter(ex => {
      const matchesSearch = search === '' ||
        ex.name.toLowerCase().includes(search.toLowerCase()) ||
        ex.primaryBodyPart.toLowerCase().includes(search.toLowerCase()) ||
        ex.equipment.toLowerCase().includes(search.toLowerCase());
      const matchesBodyPart = bodyPartFilter === 'All' || ex.primaryBodyPart === bodyPartFilter;
      const matchesEquipment = equipmentFilter === 'All' || ex.equipment === equipmentFilter;
      const matchesDifficulty = difficultyFilter === 'All' || ex.difficulty === difficultyFilter;
      const matchesType = typeFilter === 'All' || ex.exerciseType === typeFilter;
      return matchesSearch && matchesBodyPart && matchesEquipment && matchesDifficulty && matchesType;
    });
  }, [search, bodyPartFilter, equipmentFilter, difficultyFilter, typeFilter]);

  const grouped = useMemo(() => {
    const groups: Record<string, typeof filtered> = {};
    for (const ex of filtered) {
      if (!groups[ex.primaryBodyPart]) groups[ex.primaryBodyPart] = [];
      groups[ex.primaryBodyPart].push(ex);
    }
    return groups;
  }, [filtered]);

  const toggleSelect = (id: ExerciseId) => {
    if (!multiSelect) {
      onSelect(id);
      return;
    }
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddSelected = () => {
    if (onSelectMultiple) {
      onSelectMultiple(Array.from(selected));
    } else {
      selected.forEach(id => onSelect(id));
    }
    setSelected(new Set());
  };

  const clearFilters = () => {
    setBodyPartFilter('All');
    setEquipmentFilter('All');
    setDifficultyFilter('All');
    setTypeFilter('All');
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 pb-2">
        <h2 className="text-xl font-bold text-foreground mb-3">Add Exercises</h2>
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search exercises..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 bg-secondary border-border"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-3 rounded-lg border transition-colors flex items-center gap-1.5 ${
              showFilters || activeFilterCount > 0
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="text-xs font-bold bg-primary text-primary-foreground rounded-full w-4 h-4 flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="bg-secondary/50 rounded-lg p-3 mb-3 space-y-3 border border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Filters</span>
              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="text-xs text-primary hover:underline">Clear all</button>
              )}
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Body Part</label>
              <div className="flex gap-1 flex-wrap">
                {BODY_PARTS.map(bp => (
                  <button
                    key={bp}
                    onClick={() => setBodyPartFilter(bp)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                      bodyPartFilter === bp
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {bp}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Equipment</label>
              <div className="flex gap-1 flex-wrap">
                {EQUIPMENT_LIST.map(eq => (
                  <button
                    key={eq}
                    onClick={() => setEquipmentFilter(eq)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                      equipmentFilter === eq
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {eq}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Difficulty</label>
                <div className="flex gap-1 flex-wrap">
                  {DIFFICULTIES.map(d => (
                    <button
                      key={d}
                      onClick={() => setDifficultyFilter(d)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                        difficultyFilter === d
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Type</label>
                <div className="flex gap-1 flex-wrap">
                  {EXERCISE_TYPES.map(t => (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(t)}
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${
                        typeFilter === t
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick body part chips (visible when filter panel is closed) */}
        {!showFilters && (
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
        )}
      </div>

      <ScrollArea className="flex-1 px-4">
        <div className="space-y-4 pb-20">
          {Object.entries(grouped).map(([bodyPart, exercises]) => (
            <div key={bodyPart}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                <span>{getBodyPartIcon(bodyPart)}</span>
                {bodyPart}
                <span className="text-muted-foreground/50">({exercises.length})</span>
              </h3>
              <div className="space-y-0.5">
                {exercises.map(ex => {
                  const isSelected = selected.has(ex.id);
                  return (
                    <button
                      key={ex.id}
                      onClick={() => toggleSelect(ex.id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center justify-between group ${
                        isSelected
                          ? 'bg-primary/10 border border-primary/30'
                          : 'hover:bg-secondary/80'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {multiSelect && (
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            isSelected
                              ? 'bg-primary border-primary'
                              : 'border-muted-foreground/30'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                          </div>
                        )}
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
                      </div>
                      {!multiSelect && (
                        <span className="text-primary opacity-0 group-hover:opacity-100 transition-opacity text-xs font-medium">
                          + Add
                        </span>
                      )}
                    </button>
                  );
                })}
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

      {/* Sticky add button for multi-select */}
      {multiSelect && selected.size > 0 && (
        <div className="sticky bottom-0 p-4 bg-background border-t border-border">
          <Button onClick={handleAddSelected} className="w-full" variant="default" size="lg">
            Add {selected.size} Exercise{selected.size > 1 ? 's' : ''}
          </Button>
        </div>
      )}
    </div>
  );
};
