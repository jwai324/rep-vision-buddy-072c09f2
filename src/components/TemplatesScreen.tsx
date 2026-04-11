import React, { useState } from 'react';
import type { WorkoutTemplate } from '@/types/workout';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface TemplatesScreenProps {
  templates: WorkoutTemplate[];
  onStart: (template: WorkoutTemplate) => void;
  onEdit: (template: WorkoutTemplate) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onBack: () => void;
}

export const TemplatesScreen: React.FC<TemplatesScreenProps> = ({ templates, onStart, onEdit, onDelete, onCreate, onBack }) => {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const exerciseLookup = useExerciseLookup();

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">←</button>
        <h2 className="text-xl font-bold text-foreground">Templates</h2>
      </div>

      {templates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No templates yet. Create one to get started!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {templates.map(t => (
            <div key={t.id} className="bg-card rounded-xl p-4 border border-border">
              <h3 className="font-semibold text-foreground mb-1">{t.name}</h3>
              <p className="text-xs text-muted-foreground mb-3">
                {t.exercises.map(e => exerciseLookup[e.exerciseId] ?? e.exerciseId).join(' → ')}
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                {t.exercises.reduce((s, e) => s + e.sets, 0)} sets total
              </p>
              <div className="flex gap-2">
                <Button variant="neon" size="sm" onClick={() => onStart(t)}>Start</Button>
                <Button variant="outline" size="sm" onClick={() => onEdit(t)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteTarget({ id: t.id, name: t.name })} className="text-set-failure">Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" onClick={onCreate} className="w-full">+ Create New Template</Button>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTarget) { onDelete(deleteTarget.id); setDeleteTarget(null); } }}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
