import React, { useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { ExerciseAnimation } from '@/components/ExerciseAnimation';
import type { ExerciseId, WorkoutSession } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { formatWeightString } from '@/utils/weightConversion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { parseLocalDate } from '@/utils/dateUtils';

interface ExerciseDetailModalProps {
  exerciseId: ExerciseId | null;
  onClose: () => void;
  history: WorkoutSession[];
  weightUnit?: WeightUnit;
}

export const ExerciseDetailModal: React.FC<ExerciseDetailModalProps> = ({ exerciseId, onClose, history, weightUnit = 'kg' }) => {
  const exercise = exerciseId ? EXERCISE_DATABASE.find(e => e.id === exerciseId) : null;

  const exerciseHistory = useMemo(() => {
    if (!exerciseId) return [];
    return history
      .map(s => {
        const exerciseLog = s.exercises.find(e => e.exerciseId === exerciseId);
        if (!exerciseLog) return null;
        return {
          date: parseLocalDate(s.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          rawDate: s.date,
          exerciseLog,
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null)
      .reverse();
  }, [exerciseId, history]);

  const volumeData = useMemo(() => {
    return exerciseHistory.map(h => {
      const volume = h.exerciseLog.sets.reduce((sum, set) => sum + (set.weight || 0) * set.reps, 0);
      return { date: h.date, volume };
    });
  }, [exerciseHistory]);

  if (!exercise) return null;

  return (
    <Dialog open={!!exerciseId} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg">{exercise.name}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="volume">Volume</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="flex-1 overflow-y-auto space-y-4 mt-4">
            <ExerciseAnimation
              exerciseName={exercise.name}
              movementPattern={exercise.movementPattern}
            />

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <InfoChip label="Body Part" value={exercise.primaryBodyPart} />
                <InfoChip label="Equipment" value={exercise.equipment} />
                <InfoChip label="Difficulty" value={exercise.difficulty} />
                <InfoChip label="Type" value={exercise.exerciseType} />
                <InfoChip label="Pattern" value={exercise.movementPattern} />
              </div>

              {exercise.secondaryMuscles.length > 0 && (
                <div>
                  <span className="text-xs text-muted-foreground font-medium">Secondary Muscles</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {exercise.secondaryMuscles.map(m => (
                      <span key={m} className="px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-xs">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="history" className="flex-1 overflow-y-auto mt-4">
            {exerciseHistory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No history for this exercise yet.
              </div>
            ) : (
              <div className="space-y-3">
                {exerciseHistory.map((h, i) => (
                  <div key={i} className="bg-secondary/50 rounded-lg p-3 border border-border">
                    <div className="text-xs text-muted-foreground mb-2">{h.date}</div>
                    <div className="space-y-1">
                      {h.exerciseLog.sets.map((set, si) => (
                        <div key={si} className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Set {set.setNumber}</span>
                          <span className="text-foreground font-medium">
                            {set.weight != null ? `${formatWeightString(set.weight, weightUnit)} × ` : ''}{set.reps} reps
                            {set.rpe ? ` @ RPE ${set.rpe}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="volume" className="flex-1 overflow-y-auto mt-4">
            {volumeData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No volume data yet. Complete a workout with this exercise.
              </div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={volumeData}>
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
                      formatter={(value: number) => [formatWeightString(value, weightUnit), 'Volume']}
                    />
                    <Line
                      type="monotone"
                      dataKey="volume"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--primary))', r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

const InfoChip: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-secondary rounded-lg px-3 py-2">
    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    <div className="text-sm font-medium text-foreground">{value}</div>
  </div>
);
