import React, { useMemo } from 'react';
import type { WorkoutSession } from '@/types/workout';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';

interface RpeTabProps {
  history: WorkoutSession[];
}

export const RpeTab: React.FC<RpeTabProps> = ({ history }) => {
  const data = useMemo(() => {
    return history
      .filter(s => !s.isRestDay)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => {
        // Calculate average RPE from all sets that have RPE
        const allRpes: number[] = [];
        for (const ex of s.exercises) {
          for (const set of ex.sets) {
            if (set.rpe != null && set.rpe > 0 && set.type !== 'warmup') allRpes.push(set.rpe);
          }
        }
        const avgRpe = allRpes.length > 0 ? Math.round((allRpes.reduce((a, b) => a + b, 0) / allRpes.length) * 10) / 10 : null;
        return avgRpe !== null ? {
          date: format(new Date(s.date.substring(0, 10) + 'T00:00:00'), 'MMM d'),
          rpe: avgRpe,
        } : null;
      })
      .filter(Boolean);
  }, [history]);

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <span className="text-4xl block mb-2">🧠</span>
        <p>No RPE data yet.</p>
        <p className="text-xs mt-1">Log RPE on your sets to track fatigue trends.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
          Average RPE per Session
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis domain={[5, 10]} tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--popover-foreground))' }} formatter={(value: number) => [value.toFixed(1), 'Avg RPE']} />
              <ReferenceLine y={8} stroke="#eab308" strokeDasharray="5 5" label={{ value: 'Target RPE 8', position: 'insideTopRight', fontSize: 10, fill: '#eab308' }} />
              <Line type="monotone" dataKey="rpe" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: 'hsl(var(--primary))' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Rising RPE with flat weights = accumulating fatigue. Dropping RPE with rising weights = good adaptation.
        </p>
      </div>
    </div>
  );
};
