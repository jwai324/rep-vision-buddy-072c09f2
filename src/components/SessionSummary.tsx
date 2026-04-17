import React, { useState, useMemo } from 'react';
import type { WorkoutSession, RecoveryActivity } from '@/types/workout';
import { SET_TYPE_CONFIG, EXERCISES } from '@/types/workout';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { Button } from '@/components/ui/button';
import type { WeightUnit } from '@/hooks/useStorage';
import { formatWeight, formatWeightString } from '@/utils/weightConversion';
import { ArrowLeft, FileText, Plus, X, Check, Search, CalendarIcon } from 'lucide-react';
import { getExerciseInputMode, getBandLevelShortLabel } from '@/utils/exerciseInputMode';
import { parseLocalDate } from '@/utils/dateUtils';
import { repairFlatSets } from '@/utils/dropsetRepair';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { format } from 'date-fns';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const REST_DAY_EXERCISE_IDS = [
  'sleep-focus', 'cold-plunge', 'sauna', 'yoga', 'walking', 'meditation',
  'massage', 'stretching', 'foam-rolling', 'swimming-full-body', 'active-rest', 'compression-cuff', 'breathing-exercises',
];
const REST_DAY_EXERCISES = EXERCISE_DATABASE.filter(ex => REST_DAY_EXERCISE_IDS.includes(ex.id));

interface SessionSummaryProps {
  session: WorkoutSession;
  weightUnit?: WeightUnit;
  onSave: () => void;
  onSaveAsTemplate: () => void;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onEdit?: (session: WorkoutSession) => void;
  onUpdateSession?: (session: WorkoutSession) => void;
  onContinue?: () => void;
  isViewMode?: boolean;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

const SUPERSET_COLORS = [
  'bg-red-500/20', 'bg-blue-500/20', 'bg-green-500/20',
  'bg-yellow-500/20', 'bg-pink-500/20', 'bg-orange-500/20',
  'bg-amber-800/20', 'bg-purple-500/20', 'bg-white/20',
];

const getSupersetColorClass = (group?: number) => {
  if (group === undefined) return '';
  return SUPERSET_COLORS[(group - 1) % SUPERSET_COLORS.length];
};

export const SessionSummary: React.FC<SessionSummaryProps> = ({ session, weightUnit = 'kg', onSave, onSaveAsTemplate, onClose, onDelete, onEdit, onUpdateSession, onContinue, isViewMode }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');

  const { exercises: customExercises } = useCustomExercisesContext();

  const allRestDayExercises = useMemo(() => {
    const customRecovery = customExercises.filter(ex => ex.isRecovery);
    return [...REST_DAY_EXERCISES, ...customRecovery];
  }, [customExercises]);

  const filteredExercises = useMemo(() => {
    if (!search) return allRestDayExercises;
    const q = search.toLowerCase();
    return allRestDayExercises.filter(ex => ex.name.toLowerCase().includes(q));
  }, [search, allRestDayExercises]);

  const activities = session.recoveryActivities ?? [];

  const updateActivities = (newActivities: RecoveryActivity[]) => {
    onUpdateSession?.({ ...session, recoveryActivities: newActivities });
  };

  const addActivity = (exerciseId: string) => {
    const activity: RecoveryActivity = { id: crypto.randomUUID(), activityId: exerciseId };
    updateActivities([...activities, activity]);
    setShowPicker(false);
    setSearch('');
  };

  const removeActivity = (activityInstanceId: string) => {
    updateActivities(activities.filter(a => a.id !== activityInstanceId));
  };

  const toggleActivityComplete = (activityInstanceId: string) => {
    updateActivities(activities.map(a =>
      a.id === activityInstanceId ? { ...a, completed: !a.completed } : a
    ));
  };

  // Infer superset groups for legacy data
  const exercisesWithGroups = React.useMemo(() => {
    const hasExplicitGroups = session.exercises.some(ex => ex.supersetGroup !== undefined);
    if (hasExplicitGroups) return session.exercises;
    let currentGroup = 0;
    let inGroup = false;
    return session.exercises.map(ex => {
      const hasSuperset = ex.sets.some(s => s.type === 'superset');
      if (hasSuperset) {
        if (!inGroup) { currentGroup++; inGroup = true; }
        return { ...ex, supersetGroup: currentGroup };
      }
      inGroup = false;
      return ex;
    });
  }, [session.exercises]);

  // Rest day view
  if (session.isRestDay && isViewMode) {
    return (
      <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
        <div className="flex items-center gap-3 pt-2">
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-extrabold text-foreground">Rest Day</h1>
            <p className="text-xs text-muted-foreground">{parseLocalDate(session.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>

        <div className="flex flex-col items-center gap-2 py-6">
          <span className="text-5xl">🛏️</span>
          <h2 className="text-2xl font-bold text-foreground">Rest Day</h2>
          <p className="text-sm text-muted-foreground">Take it easy and recover.</p>
        </div>

        {/* Date Picker */}
        {onUpdateSession && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className={cn("w-full justify-start text-left font-normal")}>
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(parseLocalDate(session.date), 'PPP')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={parseLocalDate(session.date)}
                onSelect={(d) => {
                  if (!d) return;
                  const yyyy = d.getFullYear();
                  const mm = String(d.getMonth() + 1).padStart(2, '0');
                  const dd = String(d.getDate()).padStart(2, '0');
                  onUpdateSession({ ...session, date: `${yyyy}-${mm}-${dd}` });
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
        )}

        {/* Recovery Activities */}
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
                  <div key={a.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${a.completed ? 'bg-primary/5 border-primary/20' : 'bg-secondary/30 border-border'}`}>
                    <button
                      onClick={() => toggleActivityComplete(a.id)}
                      className={`w-7 h-7 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${a.completed ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/30 text-transparent hover:border-muted-foreground/50'}`}
                    >
                      {a.completed && <Check className="w-4 h-4" />}
                    </button>
                    <span className="text-lg">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${a.completed ? 'text-muted-foreground line-through' : 'text-foreground'}`}>{name}</p>
                      {info && <p className="text-[10px] text-muted-foreground">{info.equipment} · {info.primaryBodyPart}</p>}
                    </div>
                    <button onClick={() => removeActivity(a.id)} className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Add Activity */}
        {!showPicker && (
          <button
            onClick={() => setShowPicker(true)}
            className="w-full border-2 border-dashed border-border rounded-xl p-4 flex items-center justify-center gap-2 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span className="text-sm font-medium">Add Recovery Exercise</span>
          </button>
        )}

        {showPicker && (
          <div className="bg-card rounded-xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-foreground">Add Exercise</p>
              <button onClick={() => { setShowPicker(false); setSearch(''); }} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search exercises..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-secondary border-border" />
            </div>
            <ScrollArea className="h-80">
              <div className="flex flex-col gap-1">
                {filteredExercises.map(ex => {
                  const icon = EXERCISES[ex.id]?.icon ?? '🏋️';
                  const alreadyAdded = activities.some(a => a.activityId === ex.id);
                  return (
                    <button key={ex.id} onClick={() => !alreadyAdded && addActivity(ex.id)} disabled={alreadyAdded} className={`flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${alreadyAdded ? 'opacity-40 cursor-not-allowed' : 'hover:bg-secondary/60'}`}>
                      <span className="text-lg">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{ex.name}</p>
                        <p className="text-[10px] text-muted-foreground">{ex.equipment} · {ex.primaryBodyPart}</p>
                      </div>
                      {alreadyAdded && <span className="text-[10px] text-muted-foreground font-medium">Added</span>}
                    </button>
                  );
                })}
                {filteredExercises.length === 0 && <p className="text-center py-4 text-sm text-muted-foreground">No exercises found</p>}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2 mt-auto">
          {onDelete && (
            <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)} className="w-full">Delete Rest Day</Button>
          )}
        </div>

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Rest Day</AlertDialogTitle>
              <AlertDialogDescription>Are you sure you want to delete this rest day? This action cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { onDelete?.(session.id); setShowDeleteConfirm(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
      {/* Header */}
      {isViewMode ? (
        <div className="flex items-center gap-3 pt-2">
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-extrabold text-foreground">Workout Details</h1>
            <p className="text-xs text-muted-foreground">{parseLocalDate(session.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</p>
          </div>
        </div>
      ) : (
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Workout Complete 🎉</h1>
          <p className="text-sm text-muted-foreground mt-1">{parseLocalDate(session.date).toLocaleDateString()}</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Duration', value: formatDuration(session.duration) },
          { label: 'Total Sets', value: session.totalSets },
          { label: 'Total Reps', value: session.totalReps },
          { label: 'Volume', value: formatWeightString(session.totalVolume, weightUnit) },
        ].map(s => (
          <div key={s.label} className="bg-card rounded-xl p-4 border border-border text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className="text-xl font-bold text-foreground mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {session.averageRpe && (
        <div className="bg-card rounded-xl p-4 border border-border text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Avg RPE</p>
          <p className="text-xl font-bold text-primary">{session.averageRpe.toFixed(1)}</p>
        </div>
      )}

      {/* Workout note */}
      {session.note && (
        <div className="bg-card rounded-xl p-4 border border-border">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Note</p>
          </div>
          <p className="text-sm text-foreground whitespace-pre-wrap">{session.note}</p>
        </div>
      )}

      {/* Exercise breakdown */}
      <div className="flex flex-col gap-3">
        {exercisesWithGroups.map((ex, i) => {
          const mode = getExerciseInputMode(ex.exerciseId);
          const icon = EXERCISES[ex.exerciseId]?.icon ?? '🏋️';

          // Build set-number labels matching ActiveSession (W1, 1, 2, 1D1, 1D2...)
          let normalCount = 0;
          let warmupCount = 0;
          let lastNormalNumber = 0;
          let dropsetIdx = 0;
          const labels = ex.sets.map(set => {
            if (set.type === 'warmup') {
              warmupCount++;
              return { label: `W${warmupCount}`, isDropset: false };
            }
            if (set.type === 'dropset') {
              dropsetIdx++;
              return {
                label: lastNormalNumber > 0 ? `${lastNormalNumber}D${dropsetIdx}` : `D${dropsetIdx}`,
                isDropset: true,
              };
            }
            normalCount++;
            lastNormalNumber = normalCount;
            dropsetIdx = 0;
            return { label: `${normalCount}`, isDropset: false };
          });

          const gridCols = mode === 'cardio'
            ? 'grid-cols-[2.5rem_1fr_3rem]'
            : 'grid-cols-[2.5rem_1fr_1fr_3rem]';

          const headers = mode === 'cardio'
            ? ['SET', 'TIME', 'RPE']
            : mode === 'band'
              ? ['SET', 'BAND', 'REPS', 'RPE']
              : ['SET', 'WEIGHT', 'REPS', 'RPE'];

          return (
          <div key={i} className={`rounded-xl p-4 border border-border ${ex.supersetGroup !== undefined ? getSupersetColorClass(ex.supersetGroup) : 'bg-card'}`}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">{icon}</span>
              <h3 className="font-semibold text-foreground">{ex.exerciseName}</h3>
            </div>
            <div className={`grid ${gridCols} gap-2 mb-2 text-[10px] uppercase tracking-widest text-muted-foreground font-bold`}>
              {headers.map((h, idx) => (
                <span key={h} className={idx === 0 ? 'text-left' : idx === headers.length - 1 ? 'text-right' : 'text-center'}>{h}</span>
              ))}
            </div>
            <div className="flex flex-col gap-1">
              {ex.sets.map((set, j) => {
                const { label, isDropset } = labels[j];
                return (
                  <div
                    key={j}
                    className={`grid ${gridCols} gap-2 items-center text-sm text-foreground ${isDropset ? 'pl-3 border-l-2 border-border ml-1' : ''}`}
                  >
                    <span className={`justify-self-start min-w-[2.25rem] px-2 py-0.5 rounded-full text-[10px] font-bold text-center ${SET_TYPE_CONFIG[set.type].colorClass}`}>
                      {label}
                    </span>
                    {mode === 'cardio' ? (
                      <span className="text-center">{set.time ?? 0} min</span>
                    ) : mode === 'band' ? (
                      <>
                        <span className="text-center">{getBandLevelShortLabel(set.weight ?? 0)}</span>
                        <span className="text-center">{set.reps}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-center">{set.weight != null ? formatWeightString(set.weight, weightUnit) : '—'}</span>
                        <span className="text-center">{set.reps}</span>
                      </>
                    )}
                    <span className="text-right text-primary text-xs">{set.rpe ? set.rpe : '—'}</span>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 mt-auto">
        {!isViewMode && (
          <>
            <Button variant="neon" onClick={onSave} className="w-full">Save Workout</Button>
            <Button variant="outline" onClick={onSaveAsTemplate} className="w-full">Save as Template</Button>
            {onContinue && (
              <Button variant="ghost" onClick={onContinue} className="w-full">Continue Workout</Button>
            )}
            <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground py-2">Discard</button>
          </>
        )}
        {isViewMode && (
          <>
            {onEdit && (
              <Button variant="neon" onClick={() => onEdit(session)} className="w-full">Edit Workout</Button>
            )}
            {onDelete && (
              <Button
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full"
              >
                Delete Workout
              </Button>
            )}
          </>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Workout</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this workout? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDelete?.(session.id);
                setShowDeleteConfirm(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
