import React, { useState, useRef } from 'react';
import type { WorkoutTemplate } from '@/types/workout';
import { describeSupersetOrder, resolveTemplateSupersets } from '@/utils/templateSupersets';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import { Button } from '@/components/ui/button';
import { Copy, Share2 } from 'lucide-react';
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

/** How far a finger may drift during a long press before it reads as a scroll. */
const LONG_PRESS_SLOP_PX = 10;

interface TemplatesScreenProps {
  templates: WorkoutTemplate[];
  onStart: (template: WorkoutTemplate) => void;
  onEdit: (template: WorkoutTemplate) => void;
  onDelete: (id: string) => void;
  /** Names of the programs that schedule this template; deletion is refused while any do. */
  usedBy?: (id: string) => string[];
  onDuplicate: (template: WorkoutTemplate) => void;
  onShare: (template: WorkoutTemplate) => void;
  onCreate: () => void;
  onBack: () => void;
}

export const TemplatesScreen: React.FC<TemplatesScreenProps> = ({ templates, onStart, onEdit, onDelete, onDuplicate, onShare, onCreate, onBack, usedBy }) => {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const blockers = deleteTarget && usedBy ? usedBy(deleteTarget.id) : [];
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchOrigin = useRef<{ x: number; y: number } | null>(null);
  const exerciseLookup = useExerciseLookup();

  const handleTouchStart = (id: string, e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchOrigin.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
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

  // A scroll keeps the finger down well past the delay and touchend does not
  // fire until it lifts, so movement is what cancels the press.
  const handleTouchMove = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const origin = touchOrigin.current;
    if (touch && origin && Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y) < LONG_PRESS_SLOP_PX) return;
    handleTouchEnd();
  };

  const handleDuplicate = (t: WorkoutTemplate) => {
    onDuplicate(t);
    setContextMenu(null);
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className="text-muted-foreground hover:text-foreground">←</button>
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
              onTouchStart={e => handleTouchStart(t.id, e)}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
              onContextMenu={(e) => { e.preventDefault(); setContextMenu(t.id); }}
            >
              <h3 className="font-semibold text-foreground mb-1">{t.name}</h3>
              <p className="text-xs text-muted-foreground mb-3">
                {describeSupersetOrder(
                  resolveTemplateSupersets(t.exercises),
                  e => exerciseLookup[e.exerciseId] ?? e.exerciseId,
                )}
              </p>
              <p className="text-xs text-muted-foreground mb-3">
                {t.exercises.reduce((s, e) => s + e.sets, 0)} sets total
              </p>
              <div className="flex gap-2">
                <Button variant="neon" size="sm" onClick={() => onStart(t)}>Start</Button>
                <Button variant="outline" size="sm" onClick={() => onEdit(t)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => onShare(t)} aria-label={`Share ${t.name}`}>
                  <Share2 className="w-4 h-4" />
                </Button>
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
              {blockers.length > 0 ? (
                // Deleting it anyway would leave the program pointing at nothing,
                // and the day's scheduled workout would then simply vanish.
                <>"{deleteTarget?.name}" is used by {blockers.map(n => `"${n}"`).join(', ')}. Remove it from {blockers.length === 1 ? 'that program' : 'those programs'} first.</>
              ) : (
                <>Are you sure you want to delete "{deleteTarget?.name}"? This action cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{blockers.length > 0 ? 'OK' : 'Cancel'}</AlertDialogCancel>
            {blockers.length === 0 && (
              <AlertDialogAction onClick={() => { if (deleteTarget) { onDelete(deleteTarget.id); setDeleteTarget(null); } }}>
                Delete
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
