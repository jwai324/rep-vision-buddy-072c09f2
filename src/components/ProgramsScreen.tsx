import React, { useState } from 'react';
import type { WorkoutProgram, WorkoutTemplate } from '@/types/workout';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface ProgramsScreenProps {
  programs: WorkoutProgram[];
  templates: WorkoutTemplate[];
  activeProgramId: string | null;
  onSetActive: (id: string | null) => void;
  onEdit: (program: WorkoutProgram) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
  onBack: () => void;
}

export const ProgramsScreen: React.FC<ProgramsScreenProps> = ({
  programs, templates, activeProgramId, onSetActive, onEdit, onDelete, onCreate, onBack
}) => {
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="p-4 flex flex-col gap-4 overflow-x-hidden min-w-0 max-w-full">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">←</button>
        <h2 className="text-xl font-bold text-foreground">Programs</h2>
      </div>

      {programs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>No programs yet. Create one to plan your training!</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {programs.map(p => (
            <div key={p.id} className={`bg-card rounded-xl p-4 border min-w-0 ${activeProgramId === p.id ? 'border-primary glow-green' : 'border-border'}`}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-foreground">{p.name}</h3>
                {activeProgramId === p.id && <span className="text-[10px] font-bold text-primary uppercase">Active</span>}
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {p.days.length} days — {p.days.filter(d => d.templateId !== 'rest').length} training, {p.days.filter(d => d.templateId === 'rest').length} rest
              </p>
              <div className="flex flex-wrap gap-1 mb-3">
                {p.days.map((d, i) => {
                  const tpl = templates.find(t => t.id === d.templateId);
                  return (
                    <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full break-all ${d.templateId === 'rest' ? 'bg-secondary text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                      {d.label}: {d.templateId === 'rest' ? 'Rest' : tpl?.name ?? '?'}
                    </span>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <Button variant={activeProgramId === p.id ? 'outline' : 'neon'} size="sm"
                  onClick={() => onSetActive(activeProgramId === p.id ? null : p.id)}>
                  {activeProgramId === p.id ? 'Deactivate' : 'Set Active'}
                </Button>
                <Button variant="outline" size="sm" onClick={() => onEdit(p)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleteTarget({ id: p.id, name: p.name })} className="text-set-failure">Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Button variant="outline" onClick={onCreate} className="w-full">+ Create New Program</Button>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this program. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTarget) { onDelete(deleteTarget.id); setDeleteTarget(null); } }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
