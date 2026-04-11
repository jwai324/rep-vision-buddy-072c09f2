import React, { useMemo } from 'react';
import type { WorkoutSession, SetType } from '@/types/workout';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, startOfWeek, endOfWeek, addDays, isWithinInterval } from 'date-fns';

const SET_TYPE_COLORS: Record<SetType, string> = {
  normal: '#3b82f6',
  superset: '#a855f7',
  dropset: '#f97316',
  failure: '#ef4444',
  warmup: '#eab308',
};

interface SetTypesTabProps {
  history: WorkoutSession[];
}

export const SetTypesTab: React.FC<SetTypesTabProps> = ({ history }) => {
  const weeklyData = useMemo(() => {
    if (history.length === 0) return [];
    const dates = history.map(s => s.date.substring(0, 10)).sort();
    const earliest = new Date(dates[0] + 'T00:00:00');
    const latest = new Date();
    const weeks: { weekStart: Date; weekEnd: Date; label: string }[] = [];
    let cursor = startOfWeek(earliest, { weekStartsOn: 1 });
    const end = endOfWeek(latest, { weekStartsOn: 1 });
    while (cursor <= end) {
      const wEnd = endOfWeek(cursor, { weekStartsOn: 1 });
      weeks.push({ weekStart: new Date(cursor), weekEnd: wEnd, label: format(cursor, 'MMM d') });
      cursor = addDays(wEnd, 1);
    }
    return weeks.slice(-12).map(week => {
      const weekSessions = history.filter(s => {
        const d = new Date(s.date.substring(0, 10) + 'T00:00:00');
        return isWithinInterval(d, { start: week.weekStart, end: week.weekEnd });
      });
      const counts: Record<string, number> = { normal: 0, superset: 0, dropset: 0, failure: 0, warmup: 0 };
      for (const s of weekSessions) {
        for (const ex of s.exercises) {
          for (const set of ex.sets) {
            counts[set.type] = (counts[set.type] || 0) + 1;
          }
        }
      }
      return { week: week.label, ...counts };
    });
  }, [history]);

  if (weeklyData.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <span className="text-4xl block mb-2">📋</span>
        <p>No set data yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
          Set Type Distribution (Weekly)
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--popover-foreground))' }} />
              <Legend wrapperStyle={{ fontSize: '10px' }} />
              <Bar dataKey="normal" stackId="a" fill={SET_TYPE_COLORS.normal} name="Normal" />
              <Bar dataKey="superset" stackId="a" fill={SET_TYPE_COLORS.superset} name="Superset" />
              <Bar dataKey="dropset" stackId="a" fill={SET_TYPE_COLORS.dropset} name="Dropset" />
              <Bar dataKey="failure" stackId="a" fill={SET_TYPE_COLORS.failure} name="Failure" />
              <Bar dataKey="warmup" stackId="a" fill={SET_TYPE_COLORS.warmup} name="Warmup" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
