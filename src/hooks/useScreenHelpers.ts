import { useCallback } from 'react';
import { format, addDays, addWeeks, getDay, isSameDay } from 'date-fns';
import { parseLocalDate, formatLocalDate } from '@/utils/dateUtils';
import type { WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';

/**
 * Build a WorkoutTemplate from a finished or viewed WorkoutSession.
 * Centralises the pattern repeated in summary, sessionDetail, and reperform flows.
 */
export function templateFromSession(session: WorkoutSession, nameOverride?: string, defaultRestSeconds: number = 90): WorkoutTemplate {
  return {
    id: crypto.randomUUID(),
    name: nameOverride ?? `Workout ${parseLocalDate(session.date).toLocaleDateString()}`,
    exercises: session.exercises.map(ex => ({
      exerciseId: ex.exerciseId,
      sets: ex.sets.length,
      targetReps: ex.sets[0]?.reps ?? 10,
      setType: ex.sets[0]?.type ?? 'normal',
      restSeconds: defaultRestSeconds,
    })),
  };
}

interface DayClickDeps {
  history: WorkoutSession[];
  futureWorkouts: FutureWorkout[];
  activeProgram: WorkoutProgram | null;
  activeProgramId: string | null;
}

// Kept as an opaque callback because Index.tsx owns the Screen union — we
// can't import that type here without a circular dep. unknown is a safer
// escape hatch than any (callers still have to narrow at the boundary).
type ScreenSetter = (screen: unknown) => void;

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
    // Ignore future workouts left over from previously-active programs — only
    // the active program's rows (and manually scheduled ones) belong here.
    const visibleFutureWorkouts = futureWorkouts.filter(
      f => f.programId === activeProgramId || f.programId === 'manual',
    );
    const hasStoredScheduled = visibleFutureWorkouts.some(f => f.date === dateStr);

    // Collect every ProgramDay that matches this date. A program can schedule
    // more than one workout on the same weekday, so keep going after the
    // first match — we need the full list to decide between opening a
    // single detail screen and routing to the day-filtered activity list.
    const programScheduled: { label: string; templateId: string }[] = [];
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
          if (match) programScheduled.push({ label: day.label, templateId: day.templateId });
        }
      }
    }

    // If a scheduled item exists for this date and nothing is completed → open detail.
    // With multiple scheduled workouts, jump to the day-filtered activity list
    // (which shows every one of them) instead of silently picking the first.
    if (!hasCompleted) {
      const storedForDate = visibleFutureWorkouts.filter(f => f.date === dateStr);
      if (storedForDate.length === 1) {
        setScreen({ type: 'futureWorkoutDetail', futureWorkout: storedForDate[0] });
        return;
      }
      if (storedForDate.length > 1) {
        setScreen({ type: 'activity', initialTab: 'future', filterDate: dateStr });
        return;
      }
      if (programScheduled.length >= 1) {
        // With multiple program-scheduled workouts on this date, open the
        // first as a synthetic detail — the day-filtered activity list
        // is empty here because no `future_workouts` rows exist yet, so
        // we surface at least one workout rather than sending the user
        // to a blank screen. Users hit "back" and can tap in again from
        // the calendar's per-day detail panel to reach the others.
        const first = programScheduled[0];
        const synthetic: FutureWorkout = {
          id: `synthetic-${dateStr}`,
          programId: activeProgramId ?? 'manual',
          date: dateStr,
          templateId: first.templateId,
          label: first.label,
        };
        setScreen({ type: 'futureWorkoutDetail', futureWorkout: synthetic });
        return;
      }
    }

    setScreen({ type: 'activity', initialTab: isPast ? 'history' : 'future', filterDate: dateStr });
  }, [history, futureWorkouts, activeProgram, activeProgramId, setScreen]);
}
