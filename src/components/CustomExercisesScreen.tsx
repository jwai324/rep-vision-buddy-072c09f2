import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2, Dumbbell, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { BODY_PARTS, EQUIPMENT_LIST, getBodyPartIcon } from '@/data/exercises';
import type { CustomExerciseInput } from '@/hooks/useCustomExercises';
import type { Exercise } from '@/data/exercises';

interface CustomExercisesScreenProps {
  exercises: (Exercise & { isCustom: true; isRecovery: boolean })[];
  onAdd: (input: CustomExerciseInput) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'] as const;
const EXERCISE_TYPES = ['Compound', 'Isolation'] as const;
const BODY_PART_OPTIONS = BODY_PARTS.filter(b => b !== 'All');
const EQUIPMENT_OPTIONS = EQUIPMENT_LIST.filter(e => e !== 'All');

export const CustomExercisesScreen: React.FC<CustomExercisesScreenProps> = ({
  exercises, onAdd, onDelete, onBack,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [bodyPart, setBodyPart] = useState('Full Body');
  const [equipment, setEquipment] = useState('None');
  const [difficulty, setDifficulty] = useState<'Beginner' | 'Intermediate' | 'Advanced'>('Intermediate');
  const [exerciseType, setExerciseType] = useState<'Compound' | 'Isolation'>('Isolation');
  const [isRecovery, setIsRecovery] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const resetForm = () => {
    setName(''); setBodyPart('Full Body'); setEquipment('None');
    setDifficulty('Intermediate'); setExerciseType('Isolation');
    setIsRecovery(false); setShowForm(false);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onAdd({
      name: name.trim(),
      primaryBodyPart: bodyPart,
      equipment,
      difficulty,
      exerciseType,
      movementPattern: 'Other',
      secondaryMuscles: [],
      isRecovery,
    });
    resetForm();
  };

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">My Exercises</h1>
      </div>

      {!showForm && (
        <Button onClick={() => setShowForm(true)} variant="outline" className="w-full border-dashed">
          <Plus className="w-4 h-4 mr-2" /> Create Exercise
        </Button>
      )}

      {showForm && (
        <ScrollArea className="max-h-[60vh]">
        <div className="bg-card rounded-xl border border-border p-4 space-y-4">
          <p className="text-sm font-bold text-foreground">New Exercise</p>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Name *</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Bulgarian Split Squat" className="bg-secondary border-border" />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Body Part</label>
            <div className="flex flex-wrap gap-1">
              {BODY_PART_OPTIONS.map(bp => (
                <button key={bp} onClick={() => setBodyPart(bp)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${bodyPart === bp ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                  {bp}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Equipment</label>
            <div className="flex flex-wrap gap-1">
              {EQUIPMENT_OPTIONS.map(eq => (
                <button key={eq} onClick={() => setEquipment(eq)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${equipment === eq ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                  {eq}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Difficulty</label>
            <div className="flex gap-1 flex-wrap">
              {DIFFICULTIES.map(d => (
                <button key={d} onClick={() => setDifficulty(d)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${difficulty === d ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Type</label>
            <div className="flex gap-1 flex-wrap">
              {EXERCISE_TYPES.map(t => (
                <button key={t} onClick={() => setExerciseType(t)}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors ${exerciseType === t ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">Rest Day Activity</p>
                <p className="text-xs text-muted-foreground">Available on rest days</p>
              </div>
            </div>
            <Switch checked={isRecovery} onCheckedChange={setIsRecovery} />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={resetForm}>Cancel</Button>
            <Button className="flex-1" onClick={handleSave} disabled={!name.trim()}>Save</Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="space-y-2 pb-8">
          {exercises.length === 0 && !showForm && (
            <div className="text-center py-12 text-muted-foreground">
              <Dumbbell className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No custom exercises yet</p>
              <p className="text-xs mt-1">Create exercises to use in your workouts</p>
            </div>
          )}
          {exercises.map(ex => (
            <div key={ex.id} className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm">{getBodyPartIcon(ex.primaryBodyPart)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold text-foreground truncate">{ex.name}</p>
                  {ex.isRecovery && <Heart className="w-3 h-3 text-primary shrink-0" />}
                </div>
                <p className="text-[10px] text-muted-foreground">{ex.equipment} · {ex.primaryBodyPart} · {ex.difficulty}</p>
              </div>
              {confirmDelete === ex.id ? (
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => { onDelete(ex.id); setConfirmDelete(null); }}>
                    Delete
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(ex.id)} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
