import React, { useState } from 'react';
import type { FutureWorkout, WorkoutTemplate, RecoveryActivity } from '@/types/workout';
import { EXERCISES, RECOVERY_ACTIVITIES } from '@/types/workout';
import { ArrowLeft, Dumbbell, Plus, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FutureWorkoutDetailProps {
  futureWorkout: FutureWorkout;
  template: WorkoutTemplate | null;
  onPerformWorkout: (template: WorkoutTemplate) => void;
  onUpdateFutureWorkout: (fw: FutureWorkout) => void;
  onBack: () => void;
}

export const FutureWorkoutDetail: React.FC<FutureWorkoutDetailProps> = ({
  futureWorkout, template, onPerformWorkout, onUpdateFutureWorkout, onBack,
}) => {
  const isRest = futureWorkout.templateId === 'rest';
  const dateStr = new Date(futureWorkout.date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const [showPicker, setShowPicker] = useState(false);
  const activities = futureWorkout.recoveryActivities ?? [];

  const addActivity = (activityId: string) => {
    const activity: RecoveryActivity = {
      id: crypto.randomUUID(),
      activityId,
    };
    const updated: FutureWorkout = {
      ...futureWorkout,
      recoveryActivities: [...activities, activity],
    };
    onUpdateFutureWorkout(updated);
    setShowPicker(false);
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

  // Group recovery activities by category for the picker
  const categories = [...new Set(RECOVERY_ACTIVITIES.map(a => a.category))];

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
                  const info = RECOVERY_ACTIVITIES.find(ra => ra.id === a.activityId);
                  if (!info) return null;
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
                        className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                          a.completed
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {a.completed ? <Check className="w-4 h-4" /> : null}
                      </button>
                      <span className="text-lg">{info.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${
                          a.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                        }`}>
                          {info.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{info.category}</p>
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
              <span className="text-sm font-medium">Add Recovery Activity</span>
            </button>
          )}

          {/* Activity Picker */}
          {showPicker && (
            <div className="bg-card rounded-xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-bold text-foreground">Add Activity</p>
                <button
                  onClick={() => setShowPicker(false)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex flex-col gap-4">
                {categories.map(cat => (
                  <div key={cat}>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">{cat}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {RECOVERY_ACTIVITIES.filter(a => a.category === cat).map(activity => (
                        <button
                          key={activity.id}
                          onClick={() => addActivity(activity.id)}
                          className="flex items-center gap-2 p-3 rounded-lg bg-secondary/40 border border-border hover:border-primary/30 hover:bg-secondary/60 transition-colors text-left"
                        >
                          <span className="text-lg">{activity.icon}</span>
                          <span className="text-xs font-semibold text-foreground">{activity.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
