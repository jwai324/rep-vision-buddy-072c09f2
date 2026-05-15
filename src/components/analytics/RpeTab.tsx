import React, { useMemo } from 'react';
import type { WorkoutSession } from '@/types/workout';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';
import { rpePerSession } from '@/utils/historyAnalysis';

interface RpeTabProps {
  history: WorkoutSession[];
}

export const RpeTab: React.FC<RpeTabProps> = ({ history }) => {
  const data = useMemo(
    () => rpePerSession(history).map(p => ({
      date: format(new Date(p.date + 'T00:00:00'), 'MMM d'),
      rpe: p.avg_rpe,
    })),
    [history],
  );

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
