import React from 'react';
import type { WorkoutSession } from '@/types/workout';
import { SET_TYPE_CONFIG } from '@/types/workout';
import { Button } from '@/components/ui/button';
import type { WeightUnit } from '@/hooks/useStorage';

interface SessionSummaryProps {
  session: WorkoutSession;
  weightUnit?: WeightUnit;
  onSave: () => void;
  onSaveAsTemplate: () => void;
  onClose: () => void;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

export const SessionSummary: React.FC<SessionSummaryProps> = ({ session, weightUnit = 'kg', onSave, onSaveAsTemplate, onClose }) => {
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
        <Button variant="neon" onClick={onSave} className="w-full">Save Workout</Button>
        <Button variant="outline" onClick={onSaveAsTemplate} className="w-full">Save as Template</Button>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground py-2">Discard</button>
      </div>
    </div>
  );
};
