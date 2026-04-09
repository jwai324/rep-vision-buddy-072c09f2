import React, { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { WorkoutTemplate, TemplateExercise, ExerciseId, SetType } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SetTypeBadge } from '@/components/SetTypeBadge';

interface TemplateBuilderProps {
  initial?: WorkoutTemplate;
  onSave: (template: WorkoutTemplate) => void;
  onCancel: () => void;
}

const setTypes: SetType[] = ['normal', 'superset', 'dropset', 'failure'];

export const TemplateBuilder: React.FC<TemplateBuilderProps> = ({ initial, onSave, onCancel }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [exercises, setExercises] = useState<TemplateExercise[]>(initial?.exercises ?? []);
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [showExercisePicker, setShowExercisePicker] = useState(false);

  const filteredExercises = useMemo(() => {
    if (!exerciseSearch) return EXERCISE_DATABASE.slice(0, 20);
    return EXERCISE_DATABASE.filter(ex =>
      ex.name.toLowerCase().includes(exerciseSearch.toLowerCase()) ||
      ex.primaryBodyPart.toLowerCase().includes(exerciseSearch.toLowerCase())
    ).slice(0, 20);
  }, [exerciseSearch]);

  const addExercise = (id: ExerciseId) => {
    setExercises(prev => [...prev, {
      exerciseId: id,
      sets: 3,
      targetReps: 10,
      setType: 'normal',
      restSeconds: 90,
    }]);
  };

  const updateExercise = (index: number, update: Partial<TemplateExercise>) => {
    setExercises(prev => prev.map((e, i) => i === index ? { ...e, ...update } : e));
  };

  const removeExercise = (index: number) => {
    setExercises(prev => prev.filter((_, i) => i !== index));
  };

  const moveExercise = (from: number, to: number) => {
    if (to < 0 || to >= exercises.length) return;
    setExercises(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  const save = () => {
    if (!name.trim() || exercises.length === 0) return;
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      exercises,
    });
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">{initial ? 'Edit' : 'New'} Template</h2>
        <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
      </div>

      <input
        type="text"
        placeholder="Template name..."
        value={name}
        onChange={e => setName(e.target.value)}
        className="bg-secondary rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary font-medium"
      />

      {/* Exercises */}
      {exercises.map((ex, i) => (
        <div key={i} className="bg-card rounded-xl p-4 border border-border flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">{EXERCISES[ex.exerciseId].icon} {EXERCISES[ex.exerciseId].name}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => moveExercise(i, i - 1)} className="text-muted-foreground hover:text-foreground text-xs px-1">↑</button>
              <button onClick={() => moveExercise(i, i + 1)} className="text-muted-foreground hover:text-foreground text-xs px-1">↓</button>
              <button onClick={() => removeExercise(i)} className="text-set-failure hover:opacity-80 text-xs px-1">✕</button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Sets</label>
              <input type="number" value={ex.sets} min={1} onChange={e => updateExercise(i, { sets: parseInt(e.target.value) || 1 })}
                className="w-full bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Target Reps</label>
              <input
                type={ex.targetReps === 'failure' ? 'text' : 'number'}
                value={ex.targetReps === 'failure' ? 'Failure' : ex.targetReps}
                readOnly={ex.targetReps === 'failure'}
                onChange={e => updateExercise(i, { targetReps: parseInt(e.target.value) || 1 })}
                className="w-full bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Rest (sec)</label>
              <input type="number" value={ex.restSeconds} min={0} step={15} onChange={e => updateExercise(i, { restSeconds: parseInt(e.target.value) || 0 })}
                className="w-full bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Target RPE</label>
              <input type="number" value={ex.targetRpe ?? ''} min={1} max={10} placeholder="–" onChange={e => updateExercise(i, { targetRpe: e.target.value ? parseInt(e.target.value) : undefined })}
                className="w-full bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none" />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            {setTypes.map(t => (
              <SetTypeBadge
                key={t} type={t} selected={ex.setType === t}
                onClick={() => updateExercise(i, {
                  setType: t,
                  targetReps: t === 'failure' ? 'failure' : (ex.targetReps === 'failure' ? 10 : ex.targetReps),
                })}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Add exercise */}
      <div className="flex flex-col gap-2">
        {!showExercisePicker ? (
          <Button variant="outline" onClick={() => setShowExercisePicker(true)} className="w-full">
            + Add Exercise
          </Button>
        ) : (
          <div className="bg-card rounded-xl p-3 border border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search exercises..."
                value={exerciseSearch}
                onChange={e => setExerciseSearch(e.target.value)}
                className="pl-9 bg-secondary border-border text-sm"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-0.5">
              {filteredExercises.map(ex => (
                <button
                  key={ex.id}
                  onClick={() => { addExercise(ex.id); setShowExercisePicker(false); setExerciseSearch(''); }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-secondary/80 transition-colors text-sm"
                >
                  <span className="text-foreground font-medium">{ex.name}</span>
                  <span className="text-xs text-muted-foreground ml-2">{ex.equipment} · {ex.primaryBodyPart}</span>
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setShowExercisePicker(false); setExerciseSearch(''); }} className="w-full text-xs">
              Cancel
            </Button>
          </div>
        )}
      </div>

      <Button variant="neon" onClick={save} disabled={!name.trim() || exercises.length === 0} className="w-full mt-2">
        Save Template
      </Button>
    </div>
  );
};
