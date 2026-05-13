import React, { useMemo, useState } from 'react';
import type { WorkoutSession, WorkoutSet } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { EXERCISE_DATABASE, BODY_PARTS } from '@/data/exercises';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import {
  getExerciseInputMode,
  type ExerciseInputMode,
  formatDistance,
  distanceUnitFromWeightUnit,
  getBandLevelShortLabel,
} from '@/utils/exerciseInputMode';
import { formatMmSs } from '@/utils/timeFormat';
import { fromKg } from '@/utils/weightConversion';

function hasDataForMode(set: WorkoutSet, mode: ExerciseInputMode): boolean {
  switch (mode) {
    case 'reps-weight':
    case 'band':
      return !!set.weight && set.weight > 0;
    case 'reps':
      return set.reps > 0;
    case 'time':
      return !!set.time && set.time > 0;
    case 'distance':
      return !!set.distance && set.distance > 0;
    case 'time-distance':
      return (!!set.time && set.time > 0) || (!!set.distance && set.distance > 0);
  }
}

const COLORS = ['hsl(var(--primary))', '#ef4444', '#3b82f6', '#10b981', '#f97316', '#a855f7'];

interface MetricConfig {
  label: string;
  getValue: (set: WorkoutSet) => number | null;
  formatValue: (value: number) => string;
}

function getMetricForMode(mode: ExerciseInputMode, weightUnit: WeightUnit): MetricConfig {
  const distUnit = distanceUnitFromWeightUnit(weightUnit);
  switch (mode) {
    case 'reps-weight':
      return {
        label: `Top Working Weight (${weightUnit})`,
        getValue: s => (s.weight && s.weight > 0 ? fromKg(s.weight, weightUnit) : null),
        formatValue: v => `${v} ${weightUnit}`,
      };
    case 'band':
      return {
        label: 'Top Band Level',
        getValue: s => (s.weight && s.weight > 0 ? s.weight : null),
        formatValue: v => `Lv ${v} · ${getBandLevelShortLabel(v)}`,
      };
    case 'reps':
      return {
        label: 'Top Reps',
        getValue: s => (s.reps > 0 ? s.reps : null),
        formatValue: v => `${v} reps`,
      };
    case 'time':
      return {
        label: 'Longest Time',
        getValue: s => (s.time && s.time > 0 ? s.time : null),
        formatValue: v => formatMmSs(v),
      };
    case 'distance':
      return {
        label: 'Longest Distance',
        getValue: s => (s.distance && s.distance > 0 ? s.distance : null),
        formatValue: v => formatDistance(v, distUnit),
      };
    case 'time-distance':
      return {
        label: 'Longest Distance',
        getValue: s => (s.distance && s.distance > 0 ? s.distance : null),
        formatValue: v => formatDistance(v, distUnit),
      };
  }
}

interface ChartPanel {
  mode: ExerciseInputMode;
  exIds: string[];
  label: string;
  formatValue: (value: number) => string;
  data: Array<Record<string, unknown>>;
}

interface StrengthTabProps {
  history: WorkoutSession[];
  weightUnit: WeightUnit;
}

export const StrengthTab: React.FC<StrengthTabProps> = ({ history, weightUnit }) => {
  const [selectedExercises, setSelectedExercises] = useState<string[]>([]);
  const [bodyPartFilter, setBodyPartFilter] = useState<string>('All');
  const { exercises: customExercises } = useCustomExercisesContext();

  const allExercises = useMemo(() => {
    const combined = [...EXERCISE_DATABASE, ...customExercises];
    return combined;
  }, [customExercises]);

  // Find exercises that appear in history (mode-aware so custom exercises with
  // non-weight modes — reps-only, time, distance — are still included).
  const exercisesInHistory = useMemo(() => {
    const ids = new Set<string>();
    for (const s of history) {
      for (const ex of s.exercises) {
        const mode = getExerciseInputMode(ex.exerciseId, customExercises);
        if (ex.sets.some(set => set.type !== 'warmup' && hasDataForMode(set, mode))) {
          ids.add(ex.exerciseId);
        }
      }
    }
    return allExercises.filter(e => ids.has(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [history, allExercises, customExercises]);

  // Body parts that have at least one exercise with logged data — suppresses
  // empty chips so the row only shows actionable filters.
  const availableBodyParts = useMemo(() => {
    const present = new Set<string>();
    for (const ex of exercisesInHistory) present.add(ex.primaryBodyPart);
    return BODY_PARTS.filter(bp => bp === 'All' || present.has(bp));
  }, [exercisesInHistory]);

  // Filter applied to the picker only — does NOT touch selectedExercises, so
  // changing the filter preserves the current chart selection.
  const filteredExercises = useMemo(() => {
    if (bodyPartFilter === 'All') return exercisesInHistory;
    return exercisesInHistory.filter(ex => ex.primaryBodyPart === bodyPartFilter);
  }, [exercisesInHistory, bodyPartFilter]);

  const toggleExercise = (id: string) => {
    setSelectedExercises(prev =>
      prev.includes(id) ? prev.filter(e => e !== id) : prev.length < 6 ? [...prev, id] : prev
    );
  };

  // Group selected exercises by their input mode so the chart can plot each
  // mode against the metric that actually has data (#21: non-weight custom
  // exercises produced an empty chart when forced through a weight-only path).
  const chartPanels = useMemo<ChartPanel[]>(() => {
    if (selectedExercises.length === 0) return [];

    const groups = new Map<ExerciseInputMode, string[]>();
    for (const exId of selectedExercises) {
      const mode = getExerciseInputMode(exId, customExercises);
      const arr = groups.get(mode) ?? [];
      arr.push(exId);
      groups.set(mode, arr);
    }

    const sorted = [...history]
      .filter(s => !s.isRestDay)
      .sort((a, b) => a.date.localeCompare(b.date));

    const panels: ChartPanel[] = [];
    for (const [mode, exIds] of groups) {
      const metric = getMetricForMode(mode, weightUnit);
      const data = sorted
        .map(session => {
          const point: Record<string, unknown> = {
            date: format(new Date(session.date.substring(0, 10) + 'T00:00:00'), 'MMM d'),
          };
          for (const exId of exIds) {
            const exLog = session.exercises.find(e => e.exerciseId === exId);
            if (exLog) {
              const values = exLog.sets
                .filter(s => s.type !== 'warmup')
                .map(s => metric.getValue(s))
                .filter((v): v is number => v != null);
              if (values.length > 0) point[exId] = Math.max(...values);
            }
          }
          return Object.keys(point).length > 1 ? point : null;
        })
        .filter((p): p is Record<string, unknown> => p !== null);

      if (data.length > 0) {
        panels.push({ mode, exIds, label: metric.label, formatValue: metric.formatValue, data });
      }
    }
    return panels;
  }, [history, selectedExercises, customExercises, weightUnit]);

  const getExerciseName = (id: string) => allExercises.find(e => e.id === id)?.name || id;

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
          Filter by Body Part
        </p>
        <div className="flex flex-wrap gap-1.5 mb-4">
          {availableBodyParts.map(bp => (
            <button
              key={bp}
              onClick={() => setBodyPartFilter(bp)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${
                bodyPartFilter === bp
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {bp}
            </button>
          ))}
        </div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
          Select Exercises (max 6)
        </p>
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
          {filteredExercises.length === 0 ? (
            <p className="text-xs text-muted-foreground">No exercises for this body part.</p>
          ) : filteredExercises.map(ex => (
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

      {selectedExercises.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">Select exercises above to see progression.</div>
      ) : chartPanels.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No data for selected exercises.</div>
      ) : (
        chartPanels.map(panel => (
          <div key={panel.mode} className="bg-card rounded-xl border border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
              {panel.label}
            </p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={panel.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      color: 'hsl(var(--popover-foreground))',
                    }}
                    formatter={(value: number, name: string) => [panel.formatValue(value), getExerciseName(name)]}
                  />
                  {panel.exIds.map((exId, i) => (
                    <Line
                      key={exId}
                      type="monotone"
                      dataKey={exId}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      connectNulls
                      name={exId}
                    />
                  ))}
                  <Legend formatter={value => getExerciseName(value as string)} wrapperStyle={{ fontSize: '10px' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ))
      )}
    </div>
  );
};
