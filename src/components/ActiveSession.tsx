import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { ExerciseId, ExerciseLog, SetType, WorkoutSet, WorkoutSession, DropSegment, TemplateExercise } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { CameraFeed } from '@/components/CameraFeed';
import { WorkoutLog } from '@/components/WorkoutLog';
import { RepCounterDisplay } from '@/components/RepCounterDisplay';
import { SetTypeBadge } from '@/components/SetTypeBadge';
import { RestTimerRing } from '@/components/RestTimerRing';
import { RpeInput } from '@/components/RpeInput';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { useRepCounter } from '@/hooks/useRepCounter';
import { useRestTimer } from '@/hooks/useRestTimer';
import { Button } from '@/components/ui/button';

interface ActiveSessionProps {
  exercises: ExerciseId[];
  templateExercises?: TemplateExercise[];
  onFinish: (session: WorkoutSession) => void;
  onCancel: () => void;
}

export const ActiveSession: React.FC<ActiveSessionProps> = ({ exercises: initialExercises, templateExercises, onFinish, onCancel }) => {
  const [activeExercises, setActiveExercises] = useState<ExerciseId[]>(initialExercises);
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [setIndex, setSetIndex] = useState(0);
  const [setType, setSetType] = useState<SetType>('normal');
  const [weight, setWeight] = useState<string>('');
  const [rpe, setRpe] = useState<number | undefined>();
  const [logs, setLogs] = useState<ExerciseLog[]>(initialExercises.map(id => ({ exerciseId: id, exerciseName: EXERCISES[id].name, sets: [] })));
  const [phase, setPhase] = useState<'active' | 'rest' | 'rpe' | 'pickExercise'>('active');
  const [dropSegments, setDropSegments] = useState<DropSegment[]>([]);
  const [dropWeight, setDropWeight] = useState('');
  const startTime = useRef(Date.now());

  const currentExercise = activeExercises[exerciseIndex];
  const tplExercise = templateExercises?.[exerciseIndex];
  const restSeconds = tplExercise?.restSeconds ?? 90;

  const { reps, increment, reset: resetReps } = useRepCounter();
  const restTimer = useRestTimer(restSeconds);

  useEffect(() => {
    if (tplExercise) {
      setSetType(tplExercise.setType);
    }
  }, [exerciseIndex, tplExercise]);

  useEffect(() => {
    if (phase === 'rest' && !restTimer.isActive && restTimer.remaining === 0) {
      setPhase('rpe');
    }
  }, [phase, restTimer.isActive, restTimer.remaining]);

  const endSet = useCallback(() => {
    const newSet: WorkoutSet = {
      setNumber: setIndex + 1,
      type: setType,
      reps,
      weight: weight ? parseFloat(weight) : undefined,
      drops: dropSegments.length > 0 ? dropSegments : undefined,
    };

    setLogs(prev => prev.map((log, i) =>
      i === exerciseIndex ? { ...log, sets: [...log.sets, newSet] } : log
    ));

    if (setType === 'superset' && exerciseIndex < activeExercises.length - 1) {
      resetReps();
      setExerciseIndex(prev => prev + 1);
      setWeight('');
      setDropSegments([]);
      return;
    }

    setPhase('rest');
    restTimer.start(restSeconds);
    setDropSegments([]);
  }, [reps, weight, setType, setIndex, exerciseIndex, activeExercises.length, resetReps, restTimer, restSeconds, dropSegments]);

  const addDrop = useCallback(() => {
    if (dropWeight && reps > 0) {
      setDropSegments(prev => [...prev, { weight: parseFloat(dropWeight), reps }]);
      resetReps();
      setDropWeight('');
    }
  }, [dropWeight, reps, resetReps]);

  const saveRpeAndContinue = useCallback(() => {
    if (rpe !== undefined) {
      setLogs(prev => prev.map((log, i) => {
        if (i === exerciseIndex && log.sets.length > 0) {
          const sets = [...log.sets];
          sets[sets.length - 1] = { ...sets[sets.length - 1], rpe };
          return { ...log, sets };
        }
        return log;
      }));
    }
  }, [rpe, exerciseIndex]);

  const nextSet = useCallback(() => {
    saveRpeAndContinue();
    setSetIndex(prev => prev + 1);
    resetReps();
    setWeight('');
    setRpe(undefined);
    setPhase('active');
  }, [saveRpeAndContinue, resetReps]);

  const switchExercise = useCallback((id: ExerciseId) => {
    saveRpeAndContinue();
    // Check if this exercise already exists in logs
    const existingIndex = activeExercises.indexOf(id);
    if (existingIndex >= 0) {
      setExerciseIndex(existingIndex);
      setSetIndex(logs[existingIndex]?.sets.length ?? 0);
    } else {
      // Add new exercise
      setActiveExercises(prev => [...prev, id]);
      setLogs(prev => [...prev, { exerciseId: id, exerciseName: EXERCISES[id].name, sets: [] }]);
      setExerciseIndex(activeExercises.length);
      setSetIndex(0);
    }
    resetReps();
    setWeight('');
    setRpe(undefined);
    setPhase('active');
  }, [saveRpeAndContinue, activeExercises, logs, resetReps]);

  const finishWorkout = useCallback(() => {
    const finalLogs = rpe !== undefined
      ? logs.map((log, i) => {
          if (i === exerciseIndex && log.sets.length > 0) {
            const sets = [...log.sets];
            sets[sets.length - 1] = { ...sets[sets.length - 1], rpe };
            return { ...log, sets };
          }
          return log;
        })
      : logs;

    const duration = Math.floor((Date.now() - startTime.current) / 1000);
    const allSets = finalLogs.flatMap(l => l.sets);
    const totalReps = allSets.reduce((s, set) => s + set.reps, 0);
    const totalVolume = allSets.reduce((s, set) => s + set.reps * (set.weight ?? 0), 0);
    const rpeSets = allSets.filter(s => s.rpe !== undefined);
    const averageRpe = rpeSets.length > 0 ? rpeSets.reduce((s, set) => s + (set.rpe ?? 0), 0) / rpeSets.length : undefined;

    onFinish({
      id: crypto.randomUUID(),
      date: new Date().toISOString(),
      exercises: finalLogs.filter(l => l.sets.length > 0),
      duration,
      totalVolume,
      totalSets: allSets.length,
      totalReps,
      averageRpe,
    });
  }, [logs, rpe, exerciseIndex, onFinish]);

  const setTypes: SetType[] = ['normal', 'superset', 'dropset', 'failure'];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Workout Log */}
      <WorkoutLog logs={logs} />

      {/* Camera */}
      <div className="p-4 pb-0">
        <CameraFeed />
      </div>

      {/* Controls */}
      <div className="flex-1 p-4 flex flex-col gap-3">
        {phase === 'pickExercise' ? (
          <>
            <ExerciseSelector onSelect={switchExercise} />
            <Button variant="outline" onClick={() => setPhase('active')} className="w-full">
              Continue {EXERCISES[currentExercise].name}
            </Button>
          </>
        ) : (
          <>
            {/* Exercise + Set info */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">
                  {EXERCISES[currentExercise].icon} {EXERCISES[currentExercise].name}
                </h2>
                <p className="text-sm text-muted-foreground">Set {setIndex + 1}</p>
              </div>
              {tplExercise?.targetRpe && (
                <span className="text-xs text-muted-foreground">Target RPE: {tplExercise.targetRpe}</span>
              )}
            </div>

            {/* Set Type Selector */}
            {phase === 'active' && (
              <div className="flex gap-2 flex-wrap">
                {setTypes.map(t => (
                  <SetTypeBadge key={t} type={t} selected={setType === t} onClick={() => setSetType(t)} />
                ))}
              </div>
            )}

            {/* Weight input */}
            {phase === 'active' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Weight (lbs)"
                  value={weight}
                  onChange={e => setWeight(e.target.value)}
                  className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}

            {/* Rep Counter or Rest Timer */}
            {phase === 'active' && (
              <>
                <RepCounterDisplay reps={reps} />
                <Button variant="simulate" size="lg" onClick={increment} className="w-full text-lg">
                  ⚡ Simulate Rep
                </Button>

                {setType === 'dropset' && reps > 0 && (
                  <div className="flex gap-2">
                    <input
                      type="number"
                      placeholder="Drop weight"
                      value={dropWeight}
                      onChange={e => setDropWeight(e.target.value)}
                      className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                    />
                    <Button variant="outline" onClick={addDrop}>Add Drop</Button>
                  </div>
                )}

                {dropSegments.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {dropSegments.map((d, i) => (
                      <span key={i} className="text-xs bg-set-dropset/20 text-set-dropset px-2 py-1 rounded">
                        {d.weight}lbs × {d.reps}
                      </span>
                    ))}
                  </div>
                )}

                <Button variant="neon" size="lg" onClick={endSet} className="w-full">
                  End Set
                </Button>
              </>
            )}

            {phase === 'rest' && restTimer.isActive && (
              <RestTimerRing
                remaining={restTimer.remaining}
                progress={restTimer.progress}
                onSkip={restTimer.skip}
                onExtend={() => restTimer.extend(30)}
              />
            )}

            {phase === 'rpe' && (
              <>
                <RpeInput value={rpe} onChange={setRpe} />
                <div className="flex gap-2">
                  <Button variant="neon" onClick={nextSet} className="flex-1">
                    Next Set
                  </Button>
                  <Button variant="outline" onClick={() => {
                    saveRpeAndContinue();
                    setPhase('pickExercise');
                  }} className="flex-1">
                    Switch Exercise
                  </Button>
                </div>
              </>
            )}

            {/* Bottom actions */}
            <div className="flex gap-2 mt-auto pt-2">
              {phase === 'active' && (
                <Button variant="outline" className="flex-1" onClick={() => setPhase('pickExercise')}>
                  Switch Exercise
                </Button>
              )}
              <Button variant="secondary" className="flex-1" onClick={finishWorkout}>
                Finish Workout
              </Button>
            </div>

            <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-foreground text-center py-2">
              Cancel Workout
            </button>
          </>
        )}
      </div>
    </div>
  );
};
