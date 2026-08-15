import React, { useMemo, useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { ExerciseAnimation } from '@/components/ExerciseAnimation';
import { Button } from '@/components/ui/button';
import type { ExerciseId, WorkoutSession } from '@/types/workout';
import type { UserPreferences, WeightUnit } from '@/hooks/useStorage';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { useStickyNotes } from '@/hooks/useStickyNotes';
import { formatWeightString, formatVolume, fromKg } from '@/utils/weightConversion';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { parseLocalDate } from '@/utils/dateUtils';

interface ExerciseDetailModalProps {
  exerciseId: ExerciseId | null;
  onClose: () => void;
  history: WorkoutSession[];
  weightUnit?: WeightUnit;
  /** Persistent per-exercise notes, keyed by exerciseId. */
  stickyNotes?: Record<string, string>;
  /** Omit to render the sticky note read-only. */
  onUpdateStickyNotes?: (prefs: Partial<UserPreferences>) => Promise<void>;
}

const noopUpdate = async () => {};

export const ExerciseDetailModal: React.FC<ExerciseDetailModalProps> = ({
  exerciseId, onClose, history, weightUnit = 'kg', stickyNotes, onUpdateStickyNotes,
}) => {
  const { exercises: customExercises } = useCustomExercisesContext();
  // Custom exercises carry `custom-`-prefixed ids and live outside
  // EXERCISE_DATABASE, so they need the second lookup to get a card at all.
  const exercise = exerciseId
    ? EXERCISE_DATABASE.find(e => e.id === exerciseId) ?? customExercises.find(e => e.id === exerciseId)
    : null;
  const isCustom = !!exercise && 'isCustom' in exercise;

  const { getStickyNote, setStickyNote } = useStickyNotes(stickyNotes ?? {}, onUpdateStickyNotes ?? noopUpdate);
  const savedNote = exerciseId ? getStickyNote(exerciseId) : '';
  const canEditNote = !!onUpdateStickyNotes;

  const [noteDraft, setNoteDraft] = useState(savedNote);
  // The modal instance is reused across exercises, so the draft has to follow
  // whichever exercise is being shown rather than persist across a switch.
  useEffect(() => { setNoteDraft(savedNote); }, [exerciseId, savedNote]);

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

  // Newest first — the opposite of the History tab, which reads as a progression.
  const sessionNotes = useMemo(
    () => exerciseHistory
      .filter(h => h.exerciseLog.note?.trim())
      .map(h => ({ date: h.date, rawDate: h.rawDate, note: h.exerciseLog.note!.trim() }))
      .reverse(),
    [exerciseHistory],
  );

  const volumeData = useMemo(() => {
    return exerciseHistory.map(h => {
      const volumeKg = h.exerciseLog.sets.reduce((sum, set) => sum + (set.weight || 0) * set.reps, 0);
      const volume = Math.round(fromKg(volumeKg, weightUnit));
      return { date: h.date, volume };
    });
  }, [exerciseHistory, weightUnit]);

  if (!exercise) return null;

  const noteDirty = noteDraft.trim() !== savedNote.trim();

  return (
    <Dialog open={!!exerciseId} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-lg flex items-center gap-2">
            <span className="min-w-0 truncate">{exercise.name}</span>
            {isCustom && (
              <span className="px-1.5 py-0.5 rounded-md bg-primary/15 text-primary text-[10px] font-bold uppercase tracking-wide shrink-0">
                Custom
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="info" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
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

          <TabsContent value="notes" className="flex-1 overflow-y-auto space-y-5 mt-4">
            <div className="space-y-2">
              <div>
                <span className="text-xs font-semibold text-foreground">📌 Sticky note</span>
                <p className="text-[11px] text-muted-foreground">
                  Stays with this exercise across all future workouts.
                </p>
              </div>
              {canEditNote ? (
                <>
                  <textarea
                    value={noteDraft}
                    onChange={e => setNoteDraft(e.target.value)}
                    placeholder="Cues, setup, pin height, anything you want to see next time..."
                    rows={3}
                    className="w-full bg-secondary/60 border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    {noteDirty && (
                      <Button variant="outline" size="sm" onClick={() => setNoteDraft(savedNote)}>
                        Cancel
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!noteDirty}
                      onClick={() => exerciseId && setStickyNote(exerciseId, noteDraft)}
                    >
                      Save note
                    </Button>
                  </div>
                </>
              ) : savedNote ? (
                <p className="text-sm text-foreground whitespace-pre-wrap bg-secondary/50 border border-border rounded-lg p-3">
                  {savedNote}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">No sticky note for this exercise yet.</p>
              )}
            </div>

            <div className="space-y-2">
              <div>
                <span className="text-xs font-semibold text-foreground">📝 From past workouts</span>
                <p className="text-[11px] text-muted-foreground">
                  Notes you wrote about this exercise during a session.
                </p>
              </div>
              {sessionNotes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No session notes for this exercise yet.</p>
              ) : (
                <div className="space-y-2">
                  {sessionNotes.map((n, i) => (
                    <div key={`${n.rawDate}-${i}`} className="bg-secondary/50 rounded-lg p-3 border border-border">
                      <div className="text-xs text-muted-foreground mb-1">{n.date}</div>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{n.note}</p>
                    </div>
                  ))}
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
                      formatter={(value: number) => [formatVolume(value, weightUnit), 'Volume']}
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
