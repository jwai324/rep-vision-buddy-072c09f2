import React, { useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { WorkoutSession } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, addDays, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';

const exerciseBodyPartMap = new Map(
  EXERCISE_DATABASE.map(ex => [ex.id, ex.primaryBodyPart])
);

const BODY_PART_COLORS: Record<string, string> = {
  Chest: '#ef4444',
  Back: '#3b82f6',
  Shoulders: '#f97316',
  Biceps: '#a855f7',
  Triceps: '#ec4899',
  Quads: '#10b981',
  Hamstrings: '#14b8a6',
  Glutes: '#f43f5e',
  Calves: '#06b6d4',
  Core: '#eab308',
  Traps: '#8b5cf6',
};

const VISIBLE_BODY_PARTS = Object.keys(BODY_PART_COLORS);

interface AnalyticsScreenProps {
  history: WorkoutSession[];
  weightUnit: WeightUnit;
  onBack: () => void;
}

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({ history, weightUnit, onBack }) => {
  const [selectedBodyPart, setSelectedBodyPart] = useState<string | null>(null);

  const weeklyData = useMemo(() => {
    if (history.length === 0) return [];

    // Find date range
    const dates = history.map(s => s.date.substring(0, 10)).sort();
    const earliest = new Date(dates[0] + 'T00:00:00');
    const latest = new Date();

    // Build weeks
    const weeks: { weekStart: Date; weekEnd: Date; label: string }[] = [];
    let cursor = startOfWeek(earliest, { weekStartsOn: 1 });
    const end = endOfWeek(latest, { weekStartsOn: 1 });

    while (cursor <= end) {
      const wEnd = endOfWeek(cursor, { weekStartsOn: 1 });
      weeks.push({
        weekStart: new Date(cursor),
        weekEnd: wEnd,
        label: format(cursor, 'MMM d'),
      });
      cursor = addDays(wEnd, 1);
    }

    // Only show last 12 weeks max
    const recentWeeks = weeks.slice(-12);

    return recentWeeks.map(week => {
      const weekSessions = history.filter(s => {
        const d = new Date(s.date.substring(0, 10) + 'T00:00:00');
        return isWithinInterval(d, { start: week.weekStart, end: week.weekEnd });
      });

      const totalVolume = weekSessions.reduce((sum, s) => sum + s.totalVolume, 0);

      const bodyPartVolumes: Record<string, number> = {};
      for (const session of weekSessions) {
        for (const ex of session.exercises) {
          const bp = exerciseBodyPartMap.get(ex.exerciseId) || 'Other';
          const vol = ex.sets.reduce((s, set) => s + (set.weight || 0) * set.reps, 0);
          bodyPartVolumes[bp] = (bodyPartVolumes[bp] || 0) + vol;
        }
      }

      return {
        week: week.label,
        totalVolume,
        ...bodyPartVolumes,
      };
    });
  }, [history]);

  const bodyPartsWithData = useMemo(() => {
    const parts = new Set<string>();
    for (const week of weeklyData) {
      for (const bp of VISIBLE_BODY_PARTS) {
        if ((week as any)[bp] > 0) parts.add(bp);
      }
    }
    return VISIBLE_BODY_PARTS.filter(bp => parts.has(bp));
  }, [weeklyData]);

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">Analytics</h1>
      </div>

      {weeklyData.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <span className="text-4xl block mb-2">📊</span>
          <p>No workout data yet.</p>
          <p className="text-xs mt-1">Complete some workouts to see your trends.</p>
        </div>
      ) : (
        <>
          {/* Total Volume Chart */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
              Weekly Total Volume ({weightUnit})
            </p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    formatter={(value: number) => [`${value.toLocaleString()} ${weightUnit}`, 'Volume']}
                  />
                  <Line
                    type="monotone"
                    dataKey="totalVolume"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'hsl(var(--primary))' }}
                    name="Total Volume"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Body Part Selector */}
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
              Volume by Body Part ({weightUnit})
            </p>
            <div className="flex flex-wrap gap-1.5 mb-4">
              <button
                onClick={() => setSelectedBodyPart(null)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  selectedBodyPart === null
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                All
              </button>
              {bodyPartsWithData.map(bp => (
                <button
                  key={bp}
                  onClick={() => setSelectedBodyPart(bp)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    selectedBodyPart === bp
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {bp}
                </button>
              ))}
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={weeklyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    formatter={(value: number, name: string) => [`${value.toLocaleString()} ${weightUnit}`, name]}
                  />
                  {selectedBodyPart ? (
                    <Line
                      type="monotone"
                      dataKey={selectedBodyPart}
                      stroke={BODY_PART_COLORS[selectedBodyPart] || 'hsl(var(--primary))'}
                      strokeWidth={2}
                      dot={{ r: 3, fill: BODY_PART_COLORS[selectedBodyPart] || 'hsl(var(--primary))' }}
                      name={selectedBodyPart}
                    />
                  ) : (
                    bodyPartsWithData.map(bp => (
                      <Line
                        key={bp}
                        type="monotone"
                        dataKey={bp}
                        stroke={BODY_PART_COLORS[bp]}
                        strokeWidth={1.5}
                        dot={false}
                        name={bp}
                      />
                    ))
                  )}
                  {!selectedBodyPart && <Legend wrapperStyle={{ fontSize: '10px' }} />}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
