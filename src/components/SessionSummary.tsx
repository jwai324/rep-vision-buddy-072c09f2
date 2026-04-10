import React, { useState } from 'react';
import type { WorkoutSession } from '@/types/workout';
import { SET_TYPE_CONFIG } from '@/types/workout';
import { Button } from '@/components/ui/button';
import type { WeightUnit } from '@/hooks/useStorage';
import { ArrowLeft } from 'lucide-react';
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

interface SessionSummaryProps {
  session: WorkoutSession;
  weightUnit?: WeightUnit;
  onSave: () => void;
  onSaveAsTemplate: () => void;
  onClose: () => void;
  /** When viewing a saved session, allow deletion instead of discard */
  onDelete?: (id: string) => void;
  onEdit?: (session: WorkoutSession) => void;
  isViewMode?: boolean;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

export const SessionSummary: React.FC<SessionSummaryProps> = ({ session, weightUnit = 'kg', onSave, onSaveAsTemplate, onClose, onDelete, onEdit, isViewMode }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-foreground">Workout Complete 🎉</h1>
        <p className="text-sm text-muted-foreground mt-1">{new Date(session.date).toLocaleDateString()}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Duration', value: formatDuration(session.duration) },
          { label: 'Total Sets', value: session.totalSets },
          { label: 'Total Reps', value: session.totalReps },
          { label: 'Volume', value: `${session.totalVolume} ${weightUnit}` },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl p-4 border border-border text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold text-foreground mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {session.averageRpe && (
        <div className="bg-card rounded-xl p-4 border border-border text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Avg RPE</p>
          <p className="text-xl font-bold text-primary">{session.averageRpe.toFixed(1)}</p>
        </div>
      )}

      {/* Exercise breakdown */}
      <div className="flex flex-col gap-3">
        {session.exercises.map((ex, i) => (
          <div key={i} className="bg-card rounded-xl p-4 border border-border">
            <h3 className="font-semibold text-foreground mb-2">{ex.exerciseName}</h3>
            <div className="flex flex-col gap-1">
              {ex.sets.map((set, j) => (
                <div key={j} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${SET_TYPE_CONFIG[set.type].colorClass} text-foreground`}>
                      {SET_TYPE_CONFIG[set.type].label}
                    </span>
                    <span className="text-muted-foreground">Set {set.setNumber}</span>
                  </div>
                  <div className="flex items-center gap-3 text-foreground">
                    <span>{set.reps} reps</span>
                    {set.weight && <span>{set.weight} {weightUnit}</span>}
                    {set.rpe && <span className="text-primary text-xs">RPE {set.rpe}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 mt-auto">
        {!isViewMode && (
          <>
            <Button variant="neon" onClick={onSave} className="w-full">Save Workout</Button>
            <Button variant="outline" onClick={onSaveAsTemplate} className="w-full">Save as Template</Button>
            <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground py-2">Discard</button>
          </>
        )}
        {isViewMode && (
          <>
            {onEdit && (
              <Button variant="neon" onClick={() => onEdit(session)} className="w-full">Edit Workout</Button>
            )}
            <Button variant="outline" onClick={onClose} className="w-full">Back</Button>
            {onDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="text-xs text-destructive hover:text-destructive/80 font-medium py-2"
              >
                Delete Workout
              </button>
            )}
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this workout? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete?.(session.id);
                setShowDeleteConfirm(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
