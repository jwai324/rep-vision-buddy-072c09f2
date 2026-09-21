import React, { useMemo, useState } from 'react';
import type { WorkoutSession } from '@/types/workout';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { volumeExcludedIds } from '@/utils/volumeExclusions';
import { sessionsInWindow } from '@/utils/historyAnalysis';

const PATTERNS = ['Push', 'Pull', 'Hinge', 'Squat', 'Lunge', 'Fly', 'Carry', 'Rotation'];

interface BalanceTabProps {
  history: WorkoutSession[];
}

export const BalanceTab: React.FC<BalanceTabProps> = ({ history }) => {
  const [period, setPeriod] = useState<30 | 60 | 90>(30);
  const { exercises: customExercises } = useCustomExercisesContext();
  const exercisePatternMap = useMemo(() => {
    const map = new Map(EXERCISE_DATABASE.map(ex => [ex.id, ex.movementPattern]));
    for (const ce of customExercises) map.set(ce.id, ce.movementPattern);
    return map;
  }, [customExercises]);
  const excludedIds = useMemo(() => volumeExcludedIds(customExercises), [customExercises]);

  const data = useMemo(() => {
    // The far edge of the window is inclusive: a workout done exactly `period`
    // days ago counts. This is the coach's own helper (rest days excluded), so
    // the radar and the numbers the coach quotes for the same window cannot
    // disagree by a day.
    const recentSessions = sessionsInWindow(history, period);

    const setCounts: Record<string, number> = {};
    for (const s of recentSessions) {
      for (const ex of s.exercises) {
        if (excludedIds.has(ex.exerciseId)) continue;
        const pattern = exercisePatternMap.get(ex.exerciseId) || 'Other';
        const workingSetCount = ex.sets.filter(set => set.type !== 'warmup').length;
        setCounts[pattern] = (setCounts[pattern] || 0) + workingSetCount;
      }
    }

    return PATTERNS
      .filter(p => setCounts[p] || PATTERNS.indexOf(p) < 5) // Always show main 5
      .map(p => ({ pattern: p, sets: setCounts[p] || 0 }));
  }, [history, period, exercisePatternMap, excludedIds]);

  const hasData = data.some(d => d.sets > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
            Volume by Movement Pattern (sets)
          </p>
          <div className="flex gap-1">
            {([30, 60, 90] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${period === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                {p}d
              </button>
            ))}
          </div>
        </div>
        {hasData ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis dataKey="pattern" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <PolarRadiusAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--popover-foreground))' }} />
                <Radar name="Sets" dataKey="sets" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.3} strokeWidth={2} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <span className="text-4xl block mb-2">🎯</span>
            <p>No data for this period.</p>
          </div>
        )}
      </div>
    </div>
  );
};
