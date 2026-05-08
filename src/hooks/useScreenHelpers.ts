import { useCallback } from 'react';
import { format, addDays, addWeeks, getDay, isSameDay } from 'date-fns';
import { parseLocalDate, formatLocalDate } from '@/utils/dateUtils';
import type { WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';

/**
 * Build a WorkoutTemplate from a finished or viewed WorkoutSession.
 * Centralises the pattern repeated in summary, sessionDetail, and reperform flows.
 */
export function templateFromSession(session: WorkoutSession, nameOverride?: string): WorkoutTemplate {
  return {
    id: crypto.randomUUID(),
    name: nameOverride ?? `Workout ${parseLocalDate(session.date).toLocaleDateString()}`,
    exercises: session.exercises.map(ex => ({
      exerciseId: ex.exerciseId,
      sets: ex.sets.length,
      targetReps: ex.sets[0]?.reps ?? 10,
      setType: ex.sets[0]?.type ?? 'normal',
      restSeconds: 90,
    })),
  };
}

interface DayClickDeps {
  history: WorkoutSession[];
  futureWorkouts: FutureWorkout[];
  activeProgram: WorkoutProgram | null;
  activeProgramId: string | null;
}

type ScreenSetter = (screen: any) => void;

/**
 * Returns a stable handler for calendar day clicks.
 * Encapsulates the programme-schedule matching logic that was inline in Dashboard props.
 */
export function useDayClickHandler(
  deps: DayClickDeps,
  setScreen: ScreenSetter,
) {
  const { history, futureWorkouts, activeProgram, activeProgramId } = deps;

  return useCallback((date: Date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const todayStr = formatLocalDate();
    const isPast = dateStr < todayStr;
    const hasCompleted = history.some(s => s.date === dateStr);
    const hasStoredScheduled = futureWorkouts.some(f => f.date === dateStr);

    // Check if active program defines a scheduled day for this date
    let programScheduled: { label: string; templateId: string } | null = null;
    if (activeProgram && !hasStoredScheduled && !hasCompleted) {
      const start = activeProgram.startDate ? parseLocalDate(activeProgram.startDate) : new Date();
      const end = addWeeks(start, activeProgram.durationWeeks ?? 8);
      if (date >= start && date < end) {
        for (const day of activeProgram.days) {
          if (!day.frequency) continue;
          const f = day.frequency;
          let match = false;
          if (f.type === 'weekly') {
            const diff = (f.weekday - getDay(start) + 7) % 7;
            let cur = addDays(start, diff);
            while (cur < end) {
              if (isSameDay(cur, date)) { match = true; break; }
              cur = addDays(cur, 7);
            }
          } else if (f.type === 'everyNDays') {
            const origin = f.startDate ? parseLocalDate(f.startDate) : start;
            let cur = new Date(origin);
            while (cur < end) {
              if (cur >= start && isSameDay(cur, date)) { match = true; break; }
              cur = addDays(cur, f.interval);
            }
          } else if (f.type === 'monthly') {
            let cur = new Date(start);
            cur.setDate(f.dayOfMonth);
            if (cur < start) cur.setMonth(cur.getMonth() + 1);
            while (cur < end) {
              if (isSameDay(cur, date)) { match = true; break; }
              const nxt = new Date(cur); nxt.setMonth(nxt.getMonth() + 1); cur = nxt;
            }
          }
          if (match) {
            programScheduled = { label: day.label, templateId: day.templateId };
            break;
          }
        }
      }
    }

    // If a scheduled item exists for this date and nothing is completed → open detail
    if (!hasCompleted) {
      const stored = futureWorkouts.find(f => f.date === dateStr);
      if (stored) {
        setScreen({ type: 'futureWorkoutDetail', futureWorkout: stored });
        return;
      }
      if (programScheduled) {
        const synthetic: FutureWorkout = {
          id: `synthetic-${dateStr}`,
          programId: activeProgramId ?? 'manual',
          date: dateStr,
          templateId: programScheduled.templateId,
          label: programScheduled.label,
        };
        setScreen({ type: 'futureWorkoutDetail', futureWorkout: synthetic });
        return;
      }
    }

    setScreen({ type: 'activity', initialTab: isPast ? 'history' : 'future', filterDate: dateStr });
  }, [history, futureWorkouts, activeProgram, activeProgramId, setScreen]);
}
