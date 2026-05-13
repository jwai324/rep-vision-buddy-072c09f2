import React, { useMemo, useState } from 'react';
import type { WorkoutSession } from '@/types/workout';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { subDays, isAfter } from 'date-fns';
import { Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { useIsMobile } from '@/hooks/use-mobile';

const BODY_PARTS = [
  'Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Quads', 'Hamstrings',
  'Glutes', 'Calves', 'Core', 'Traps', 'Hip Flexors', 'Forearms', 'Full Body',
  'Cardio', 'Neck',
];

interface FrequencyTabProps {
  history: WorkoutSession[];
}

export const FrequencyTab: React.FC<FrequencyTabProps> = ({ history }) => {
  const [period, setPeriod] = useState<7 | 14 | 30>(7);
  const { exercises: customExercises } = useCustomExercisesContext();
  const isMobile = useIsMobile();
  const exerciseBodyPartMap = useMemo(() => {
    const map = new Map(EXERCISE_DATABASE.map(ex => [ex.id, ex.primaryBodyPart]));
    for (const ce of customExercises) map.set(ce.id, ce.primaryBodyPart);
    return map;
  }, [customExercises]);

  const data = useMemo(() => {
    const cutoff = subDays(new Date(), period);
    const recentSessions = history.filter(s => {
      const d = new Date(s.date.substring(0, 10) + 'T00:00:00');
      return isAfter(d, cutoff) && !s.isRestDay;
    });

    const counts: Record<string, number> = {};
    for (const s of recentSessions) {
      const sessionParts = new Set<string>();
      for (const ex of s.exercises) {
        const bp = exerciseBodyPartMap.get(ex.exerciseId);
        if (bp) sessionParts.add(bp);
      }
      for (const bp of sessionParts) {
        counts[bp] = (counts[bp] || 0) + 1;
      }
    }

    const weeks = period / 7;
    return BODY_PARTS.map(bp => {
      const count = counts[bp] || 0;
      const perWeek = count / weeks;
      let color: string;
      if (count === 0) color = '#ef4444'; // red - never trained
      else if (perWeek < 1.5) color = '#eab308'; // yellow - under
      else if (perWeek <= 3.5) color = '#10b981'; // green - optimal
      else color = '#f97316'; // orange - high
      return { bodyPart: bp, sessions: count, perWeek: Math.round(perWeek * 10) / 10, color };
    })
      .filter(d => d.sessions > 0)
      .sort((a, b) => b.sessions - a.sessions);
  }, [history, period]);

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-3">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground font-bold"
                aria-label="About Muscle Group Frequency"
              >
                Muscle Group Frequency
                <Info className="w-3 h-3" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 text-xs normal-case tracking-normal" align="start">
              Shows how many sessions each muscle group was trained in the selected period.
              Color indicates weekly frequency:{' '}
              <span className="text-[#10b981] font-semibold">green</span> = optimal (1.5–3.5×/wk),{' '}
              <span className="text-[#eab308] font-semibold">yellow</span> = undertrained (&lt;1.5×/wk),{' '}
              <span className="text-[#f97316] font-semibold">orange</span> = high frequency (&gt;3.5×/wk).
            </PopoverContent>
          </Popover>
          <div className="flex gap-1">
            {([7, 14, 30] as const).map(p => (
              <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${period === p ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>
                {p}d
              </button>
            ))}
          </div>
        </div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ left: isMobile ? 0 : 70 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis type="category" dataKey="bodyPart" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} width={isMobile ? 60 : 65} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--popover-foreground))' }} formatter={(value: number, _: string, entry: any) => [`${value} sessions (${entry.payload.perWeek}/wk)`, 'Frequency']} />
              <Bar dataKey="sessions" radius={[0, 4, 4, 0]}>
                {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-3 mt-3 justify-center flex-wrap">
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-[#eab308]" /><span className="text-[10px] text-muted-foreground">&lt;1.5×/wk</span></div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-[#10b981]" /><span className="text-[10px] text-muted-foreground">1.5–3.5×/wk</span></div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-[#f97316]" /><span className="text-[10px] text-muted-foreground">&gt;3.5×/wk</span></div>
        </div>
      </div>
    </div>
  );
};
