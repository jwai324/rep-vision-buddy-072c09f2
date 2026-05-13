import React, { useMemo, useState } from 'react';
import type { WorkoutSession } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, addDays, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { fromKg } from '@/utils/weightConversion';

const BODY_PART_COLORS: Record<string, string> = {
  Chest: '#ef4444', Back: '#3b82f6', Shoulders: '#f97316', Biceps: '#a855f7',
  Triceps: '#ec4899', Quads: '#10b981', Hamstrings: '#14b8a6', Glutes: '#f43f5e',
  Calves: '#06b6d4', Core: '#eab308', Traps: '#8b5cf6',
  'Hip Flexors': '#84cc16', Forearms: '#f59e0b', 'Full Body': '#64748b',
  Cardio: '#0ea5e9', Neck: '#d946ef',
};

const VISIBLE_BODY_PARTS = Object.keys(BODY_PART_COLORS);

interface VolumeTabProps {
  history: WorkoutSession[];
  weightUnit: WeightUnit;
}

export const VolumeTab: React.FC<VolumeTabProps> = ({ history, weightUnit }) => {
  const [selectedBodyParts, setSelectedBodyParts] = useState<Set<string>>(new Set());
  const { exercises: customExercises } = useCustomExercisesContext();
  const exerciseBodyPartMap = useMemo(() => {
    const map = new Map(EXERCISE_DATABASE.map(ex => [ex.id, ex.primaryBodyPart]));
    for (const ce of customExercises) map.set(ce.id, ce.primaryBodyPart);
    return map;
  }, [customExercises]);

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
    const recentWeeks = weeks.slice(-12);
    return recentWeeks.map(week => {
      const weekSessions = history.filter(s => {
        const d = new Date(s.date.substring(0, 10) + 'T00:00:00');
        return isWithinInterval(d, { start: week.weekStart, end: week.weekEnd });
      });
      // Aggregate in kg, convert to display unit at the end (reps are unit-invariant).
      const totalVolumeKg = weekSessions.reduce((sum, s) => sum + s.totalVolume, 0);
      const bodyPartVolumes: Record<string, number> = {};
      for (const bp of VISIBLE_BODY_PARTS) bodyPartVolumes[bp] = 0;
      for (const session of weekSessions) {
        for (const ex of session.exercises) {
          const bp = exerciseBodyPartMap.get(ex.exerciseId) || 'Other';
<<<<<<< HEAD
          const volKg = ex.sets.reduce(
            (s, set) => (set.type === 'warmup' ? s : s + (set.weight || 0) * set.reps),
            0
          );
=======
          const volKg = ex.sets.reduce((s, set) => (set.type === 'warmup' ? s : s + (set.weight || 0) * set.reps), 0);
>>>>>>> 45062a7 (fix(analytics): restore warmup filter in VolumeTab volume sum (#33))
          bodyPartVolumes[bp] = (bodyPartVolumes[bp] || 0) + volKg;
        }
      }
      const convertedBodyPartVolumes: Record<string, number> = {};
      for (const bp of Object.keys(bodyPartVolumes)) {
        convertedBodyPartVolumes[bp] = Math.round(fromKg(bodyPartVolumes[bp], weightUnit));
      }
      return { week: week.label, totalVolume: Math.round(fromKg(totalVolumeKg, weightUnit)), ...convertedBodyPartVolumes };
    });
  }, [history, weightUnit, exerciseBodyPartMap]);

  const bodyPartsWithData = useMemo(() => {
    const parts = new Set<string>();
    for (const week of weeklyData) {
      for (const bp of VISIBLE_BODY_PARTS) {
        if ((week as any)[bp] > 0) parts.add(bp);
      }
    }
    return VISIBLE_BODY_PARTS.filter(bp => parts.has(bp));
  }, [weeklyData]);

  if (weeklyData.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <span className="text-4xl block mb-2">📊</span>
        <p>No workout data yet.</p>
        <p className="text-xs mt-1">Complete some workouts to see your trends.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
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
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--popover-foreground))' }} formatter={(value: number) => [`${value.toLocaleString()} ${weightUnit}`, 'Volume']} />
              <Line type="monotone" dataKey="totalVolume" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3, fill: 'hsl(var(--primary))' }} name="Total Volume" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
          Volume by Body Part ({weightUnit})
        </p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button onClick={() => setSelectedBodyParts(new Set())} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${selectedBodyParts.size === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`}>All</button>
          {bodyPartsWithData.map(bp => (
            <button key={bp} onClick={() => setSelectedBodyParts(prev => {
              const next = new Set(prev);
              if (next.has(bp)) next.delete(bp); else next.add(bp);
              return next;
            })} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${selectedBodyParts.has(bp) ? 'text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'}`} style={selectedBodyParts.has(bp) ? { backgroundColor: BODY_PART_COLORS[bp] || 'hsl(var(--primary))' } : undefined}>{bp}</button>
          ))}
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={weeklyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '8px', color: 'hsl(var(--popover-foreground))' }} formatter={(value: number, name: string) => [`${value.toLocaleString()} ${weightUnit}`, name]} />
              {(selectedBodyParts.size > 0 ? bodyPartsWithData.filter(bp => selectedBodyParts.has(bp)) : bodyPartsWithData).map(bp => (
                <Line key={bp} type="monotone" dataKey={bp} stroke={BODY_PART_COLORS[bp]} strokeWidth={selectedBodyParts.size > 0 ? 2 : 1.5} dot={selectedBodyParts.size > 0 ? { r: 3, fill: BODY_PART_COLORS[bp] } : false} name={bp} />
              ))}
              {selectedBodyParts.size === 0 && <Legend wrapperStyle={{ fontSize: '10px' }} />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};
