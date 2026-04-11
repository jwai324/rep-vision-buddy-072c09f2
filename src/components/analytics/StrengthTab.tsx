import React, { useMemo, useState } from 'react';
import type { WorkoutSession } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';

const COLORS = ['hsl(var(--primary))', '#ef4444', '#3b82f6', '#10b981', '#f97316', '#a855f7'];

interface StrengthTabProps {
  history: WorkoutSession[];
  weightUnit: WeightUnit;
}

export const StrengthTab: React.FC<StrengthTabProps> = ({ history, weightUnit }) => {
  const [selectedExercises, setSelectedExercises] = useState<string[]>([]);

  // Find exercises that appear in history
  const exercisesInHistory = useMemo(() => {
    const ids = new Set<string>();
    for (const s of history) {
      for (const ex of s.exercises) {
        if (ex.sets.some(set => set.weight && set.weight > 0)) {
          ids.add(ex.exerciseId);
        }
      }
    }
    return EXERCISE_DATABASE.filter(e => ids.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [history]);

  const toggleExercise = (id: string) => {
    setSelectedExercises(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : prev.length < 6 ? [...prev, id] : prev
    );
  };

  const chartData = useMemo(() => {
    if (selectedExercises.length === 0) return [];
    const sorted = [...history]
      .filter(s => !s.isRestDay)
      .sort((a, b) => a.date.localeCompare(b.date));

    return sorted.map(session => {
      const point: Record<string, any> = { date: format(new Date(session.date.substring(0, 10) + 'T00:00:00'), 'MMM d') };
      for (const exId of selectedExercises) {
        const exLog = session.exercises.find(e => e.exerciseId === exId);
        if (exLog) {
          // Heaviest working set (exclude warmup)
          const workingSets = exLog.sets.filter(s => s.type !== 'warmup' && s.weight && s.weight > 0);
          if (workingSets.length > 0) {
            point[exId] = Math.max(...workingSets.map(s => s.weight || 0));
          }
        }
      }
      // Only include if at least one selected exercise has data
      return Object.keys(point).length > 1 ? point : null;
    }).filter(Boolean);
  }, [history, selectedExercises]);

  const getExerciseName = (id: string) => EXERCISE_DATABASE.find(e => e.id === id)?.name || id;

  if (exercisesInHistory.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <span className="text-4xl block mb-2">💪</span>
        <p>No strength data yet.</p>
        <p className="text-xs mt-1">Log workouts with weights to track progression.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
          Select Exercises (max 6)
        </p>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {exercisesInHistory.map(ex => (
            <button
              key={ex.id}
              onClick={() => toggleExercise(ex.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                selectedExercises.includes(ex.id)
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {ex.name}
            </button>
          ))}
        </div>
      </div>

      {selectedExercises.length > 0 && chartData.length > 0 ? (
        <div className="bg-card rounded-xl border border-border p-4">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
            Top Working Weight ({weightUnit})
          </p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--popover-foreground))' }} formatter={(value: number, name: string) => [`${value} ${weightUnit}`, getExerciseName(name)]} />
                {selectedExercises.map((exId, i) => (
                  <Line key={exId} type="monotone" dataKey={exId} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls name={exId} />
                ))}
                <Legend formatter={(value) => getExerciseName(value)} wrapperStyle={{ fontSize: '10px' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : selectedExercises.length > 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No data for selected exercises.</div>
      ) : (
        <div className="text-center py-8 text-muted-foreground text-sm">Select exercises above to see progression.</div>
      )}
    </div>
  );
};
