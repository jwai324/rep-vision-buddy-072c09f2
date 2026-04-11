import React, { useState } from 'react';
import { ArrowLeft, Plus, Trash2, Dumbbell, Heart, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getBodyPartIcon } from '@/data/exercises';
import type { CustomExerciseInput } from '@/hooks/useCustomExercises';
import type { Exercise } from '@/data/exercises';
import { CreateExerciseForm } from '@/components/CreateExerciseForm';

interface CustomExercisesScreenProps {
  exercises: (Exercise & { isCustom: true; isRecovery: boolean })[];
  onAdd: (input: CustomExerciseInput) => void;
  onUpdate: (id: string, input: CustomExerciseInput) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}

export const CustomExercisesScreen: React.FC<CustomExercisesScreenProps> = ({
  exercises, onAdd, onUpdate, onDelete, onBack,
}) => {
  const [editingExercise, setEditingExercise] = useState<(Exercise & { isCustom: true; isRecovery: boolean }) | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const handleSave = (input: CustomExerciseInput) => {
    if (editingExercise) {
      onUpdate(editingExercise.id, input);
    } else {
      onAdd(input);
    }
    setShowForm(false);
    setEditingExercise(null);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingExercise(null);
  };

  const openEdit = (ex: Exercise & { isCustom: true; isRecovery: boolean }) => {
    setEditingExercise(ex);
    setShowForm(true);
  };

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4 overflow-y-auto">
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">My Exercises</h1>
      </div>

      {!showForm && (
        <Button onClick={() => { setEditingExercise(null); setShowForm(true); }} variant="outline" className="w-full border-dashed">
          <Plus className="w-4 h-4 mr-2" /> Create Exercise
        </Button>
      )}

      {showForm && (
        <CreateExerciseForm
          onSave={handleSave}
          onCancel={handleCancel}
          editingExercise={editingExercise}
        />
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
            <button
              key={ex.id}
              onClick={() => openEdit(ex)}
              className="w-full bg-card rounded-xl border border-border p-3 flex items-center gap-3 text-left hover:border-primary/30 transition-colors"
            >
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
                <div className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => { onDelete(ex.id); setConfirmDelete(null); }}>
                    Delete
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <button onClick={() => openEdit(ex)} className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setConfirmDelete(ex.id)} className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};
