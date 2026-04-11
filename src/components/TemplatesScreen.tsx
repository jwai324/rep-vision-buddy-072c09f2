import React, { useState, useRef } from 'react';
import type { WorkoutTemplate } from '@/types/workout';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
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
  onDuplicate: (template: WorkoutTemplate) => void;
  onCreate: () => void;
  onBack: () => void;
}

export const TemplatesScreen: React.FC<TemplatesScreenProps> = ({ templates, onStart, onEdit, onDelete, onDuplicate, onCreate, onBack }) => {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exerciseLookup = useExerciseLookup();

  const handleTouchStart = (id: string) => {
    longPressTimer.current = setTimeout(() => {
      setContextMenu(id);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleDuplicate = (t: WorkoutTemplate) => {
    onDuplicate(t);
    setContextMenu(null);
  };

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
            <div
              key={t.id}
              className="bg-card rounded-xl p-4 border border-border relative"
              onTouchStart={() => handleTouchStart(t.id)}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(t.id); }}
            >
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

              {contextMenu === t.id && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
                  <div className="absolute right-2 top-2 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
                    <button
                      onClick={() => handleDuplicate(t)}
                      className="w-full px-3 py-2.5 text-left text-sm font-medium text-foreground hover:bg-secondary transition-colors flex items-center gap-2"
                    >
                      <Copy className="w-4 h-4" />
                      Duplicate Template
                    </button>
                  </div>
                </>
              )}
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
