import React, { useState, useMemo } from 'react';
import type { FutureWorkout, WorkoutTemplate, RecoveryActivity, WorkoutSession } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { ArrowLeft, Dumbbell, Plus, X, Check, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

// Rest-day eligible exercises (recovery/wellness type)
const REST_DAY_EXERCISE_IDS = [
  'sleep-focus', 'cold-plunge', 'sauna', 'yoga', 'walking', 'meditation',
  'massage', 'stretching', 'foam-rolling', 'swimming-full-body', 'active-rest', 'compression-cuff', 'breathing-exercises',
];

const REST_DAY_EXERCISES = EXERCISE_DATABASE.filter(ex => REST_DAY_EXERCISE_IDS.includes(ex.id));

interface FutureWorkoutDetailProps {
  futureWorkout: FutureWorkout;
  template: WorkoutTemplate | null;
  onPerformWorkout: (template: WorkoutTemplate) => void;
  onUpdateFutureWorkout: (fw: FutureWorkout) => void;
  onSaveRestDay?: (fw: FutureWorkout) => void;
  onBack: () => void;
}

export const FutureWorkoutDetail: React.FC<FutureWorkoutDetailProps> = ({
  futureWorkout, template, onPerformWorkout, onUpdateFutureWorkout, onSaveRestDay, onBack,
}) => {
  const isRest = futureWorkout.templateId === 'rest';
  const dateStr = new Date(futureWorkout.date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const activities = futureWorkout.recoveryActivities ?? [];

  const filteredExercises = useMemo(() => {
    if (!search) return REST_DAY_EXERCISES;
    const q = search.toLowerCase();
    return REST_DAY_EXERCISES.filter(ex => ex.name.toLowerCase().includes(q));
  }, [search]);

  const addActivity = (exerciseId: string) => {
    const activity: RecoveryActivity = {
      id: crypto.randomUUID(),
      activityId: exerciseId,
    };
    const updated: FutureWorkout = {
      ...futureWorkout,
      recoveryActivities: [...activities, activity],
    };
    onUpdateFutureWorkout(updated);
    setShowPicker(false);
    setSearch('');
  };

  const removeActivity = (activityInstanceId: string) => {
    const updated: FutureWorkout = {
      ...futureWorkout,
      recoveryActivities: activities.filter(a => a.id !== activityInstanceId),
    };
    onUpdateFutureWorkout(updated);
  };

  const toggleActivityComplete = (activityInstanceId: string) => {
    const updated: FutureWorkout = {
      ...futureWorkout,
      recoveryActivities: activities.map(a =>
        a.id === activityInstanceId ? { ...a, completed: !a.completed } : a
      ),
    };
    onUpdateFutureWorkout(updated);
  };

  const allCompleted = activities.length > 0 && activities.every(a => a.completed);

  const handleSaveRestDay = () => {
    if (onSaveRestDay) {
      onSaveRestDay(futureWorkout);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl font-extrabold text-foreground">{futureWorkout.label}</h1>
          <p className="text-xs text-muted-foreground">{dateStr}</p>
        </div>
      </div>

      {isRest ? (
        <div className="flex flex-col gap-4 flex-1">
          {/* Rest Day Header */}
          <div className="flex flex-col items-center gap-2 py-6">
            <span className="text-5xl">🛏️</span>
            <h2 className="text-2xl font-bold text-foreground">Rest Day</h2>
            <p className="text-sm text-muted-foreground">Take it easy and recover.</p>
          </div>

          {/* Added Recovery Activities */}
          {activities.length > 0 && (
            <div className="bg-card rounded-xl border border-border p-4">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">Recovery Plan</p>
              <div className="flex flex-col gap-2">
                {activities.map(a => {
                  const info = EXERCISE_DATABASE.find(ex => ex.id === a.activityId);
                  const lookup = EXERCISES[a.activityId];
                  if (!info && !lookup) return null;
                  const name = info?.name ?? lookup?.name ?? a.activityId;
                  const icon = lookup?.icon ?? '🏋️';
                  return (
                    <div
                      key={a.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        a.completed
                          ? 'bg-primary/5 border-primary/20'
                          : 'bg-secondary/30 border-border'
                      }`}
                    >
                      <button
                        onClick={() => toggleActivityComplete(a.id)}
                        className={`w-7 h-7 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                          a.completed
                            ? 'bg-primary border-primary text-primary-foreground'
                            : 'border-muted-foreground/30 text-transparent hover:border-muted-foreground/50'
                        }`}
                      >
                        {a.completed && <Check className="w-4 h-4" />}
                      </button>
                      <span className="text-lg">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${
                          a.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                        }`}>
                          {name}
                        </p>
                        {info && (
                          <p className="text-[10px] text-muted-foreground">{info.equipment} · {info.primaryBodyPart}</p>
                        )}
                      </div>
                      <button
                        onClick={() => removeActivity(a.id)}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add Activity Button */}
          {!showPicker && (
            <button
              onClick={() => setShowPicker(true)}
              className="w-full border-2 border-dashed border-border rounded-xl p-4 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span className="text-sm font-medium">Add Recovery Exercise</span>
            </button>
          )}

          {/* Exercise Picker */}
          {showPicker && (
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-foreground">Add Exercise</p>
                <button
                  onClick={() => { setShowPicker(false); setSearch(''); }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search exercises..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 bg-secondary border-border"
                />
              </div>
              <ScrollArea className="max-h-64">
                <div className="flex flex-col gap-1">
                  {filteredExercises.map(ex => {
                    const icon = EXERCISES[ex.id]?.icon ?? '🏋️';
                    const alreadyAdded = activities.some(a => a.activityId === ex.id);
                    return (
                      <button
                        key={ex.id}
                        onClick={() => !alreadyAdded && addActivity(ex.id)}
                        disabled={alreadyAdded}
                        className={`flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${
                          alreadyAdded
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-secondary/60'
                        }`}
                      >
                        <span className="text-lg">{icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{ex.name}</p>
                          <p className="text-[10px] text-muted-foreground">{ex.equipment} · {ex.primaryBodyPart}</p>
                        </div>
                        {alreadyAdded && (
                          <span className="text-[10px] text-muted-foreground font-medium">Added</span>
                        )}
                      </button>
                    );
                  })}
                  {filteredExercises.length === 0 && (
                    <p className="text-center py-4 text-sm text-muted-foreground">No exercises found</p>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Save Rest Day to History */}
          {activities.length > 0 && onSaveRestDay && (
            <div className="mt-auto pb-4">
              <Button
                variant={allCompleted ? 'default' : 'outline'}
                size="lg"
                className="w-full text-base"
                onClick={handleSaveRestDay}
              >
                <Check className="w-5 h-5 mr-2" />
                {allCompleted ? 'Complete Rest Day' : 'Save Rest Day'}
              </Button>
            </div>
          )}
        </div>
      ) : template ? (
        <div className="flex flex-col gap-4 flex-1">
          <div className="bg-card rounded-xl border border-border p-4">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">Exercises</p>
            <div className="flex flex-col gap-3">
              {template.exercises.map((ex, i) => {
                const info = EXERCISES[ex.exerciseId];
                return (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-sm">{info?.icon ?? '🏋️'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{info?.name ?? ex.exerciseId}</p>
                      <p className="text-xs text-muted-foreground">
                        {ex.sets} sets × {ex.targetReps === 'failure' ? 'failure' : `${ex.targetReps} reps`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-auto pb-4">
            <Button
              variant="neon"
              size="lg"
              className="w-full text-base"
              onClick={() => onPerformWorkout(template)}
            >
              <Dumbbell className="w-5 h-5 mr-2" />
              Perform Workout
            </Button>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <p>Template not found for this workout.</p>
        </div>
      )}
    </div>
  );
};