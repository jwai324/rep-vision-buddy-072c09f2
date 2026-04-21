import React, { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { addDays, addWeeks, format, getDay, isSameDay } from 'date-fns';
import { parseLocalDate, formatLocalDate } from '@/utils/dateUtils';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import type {
  WorkoutSession,
  WorkoutTemplate,
  WorkoutProgram,
  FutureWorkout,
} from '@/types/workout';
import { RECOVERY_ACTIVITIES } from '@/types/workout';
import { cn } from '@/lib/utils';

interface Props {
  history: WorkoutSession[];
  templates: WorkoutTemplate[];
  futureWorkouts: FutureWorkout[];
  activeProgram: WorkoutProgram | null;
  onBack: () => void;
  onStartTemplate: (template: WorkoutTemplate) => void;
  onOpenFutureWorkout: (fw: FutureWorkout) => void;
  onOpenSession: (session: WorkoutSession) => void;
  onAddRestDay: (dateStr: string) => void;
}

// Compute program-scheduled day for a given date (mirrors Index.tsx logic)
function getProgramScheduled(
  date: Date,
  program: WorkoutProgram | null
): { label: string; templateId: string } | null {
  if (!program) return null;
  const start = program.startDate ? parseLocalDate(program.startDate) : new Date();
  const end = addWeeks(start, program.durationWeeks ?? 8);
  if (date < start || date >= end) return null;

  for (const day of program.days) {
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
    if (match) return { label: day.label, templateId: day.templateId };
  }
  return null;
}

export const MonthlyCalendarScreen: React.FC<Props> = ({
  history,
  templates,
  futureWorkouts,
  activeProgram,
  onBack,
  onStartTemplate,
  onOpenFutureWorkout,
  onOpenSession,
  onAddRestDay,
}) => {
  const [selected, setSelected] = useState<Date>(new Date());
  const [month, setMonth] = useState<Date>(new Date());
  const lookup = useExerciseLookup();

  // Build modifier date sets
  const { completedWorkout, completedRest, scheduledWorkout, scheduledRest } = useMemo(() => {
    const cw: Date[] = [];
    const cr: Date[] = [];
    const sw: Date[] = [];
    const sr: Date[] = [];

    for (const s of history) {
      const d = parseLocalDate(s.date.length >= 10 ? s.date.substring(0, 10) : s.date);
      (s.isRestDay ? cr : cw).push(d);
    }
    for (const f of futureWorkouts) {
      const d = parseLocalDate(f.date);
      (f.templateId === 'rest' ? sr : sw).push(d);
    }
    const hasProgramFutureWorkouts = activeProgram && futureWorkouts.some(f => f.programId === activeProgram.id);
    if (activeProgram && !hasProgramFutureWorkouts) {
      const start = activeProgram.startDate ? parseLocalDate(activeProgram.startDate) : new Date();
      const end = addWeeks(start, activeProgram.durationWeeks ?? 8);
      let cur = new Date(start);
      while (cur < end) {
        const dateStr = format(cur, 'yyyy-MM-dd');
        const hasCompleted = history.some(s => (s.date.length >= 10 ? s.date.substring(0, 10) : s.date) === dateStr);
        const hasStored = futureWorkouts.some(f => f.date === dateStr);
        if (!hasCompleted && !hasStored) {
          const ps = getProgramScheduled(cur, activeProgram);
          if (ps) (ps.templateId === 'rest' ? sr : sw).push(new Date(cur));
        }
        cur = addDays(cur, 1);
      }
    }
    return { completedWorkout: cw, completedRest: cr, scheduledWorkout: sw, scheduledRest: sr };
  }, [history, futureWorkouts, activeProgram]);

  // Compute selected day content
  const dayDetail = useMemo(() => {
    const dateStr = format(selected, 'yyyy-MM-dd');
    const sessions = history.filter(s => {
      const sd = s.date.length >= 10 ? s.date.substring(0, 10) : s.date;
      return sd === dateStr;
    });
    const stored = futureWorkouts.find(f => f.date === dateStr);
    const programDay = !sessions.length && !stored ? getProgramScheduled(selected, activeProgram) : null;
    return { dateStr, sessions, stored, programDay };
  }, [selected, history, futureWorkouts, activeProgram]);

  const selectedTemplate = useMemo(() => {
    if (dayDetail.stored) return templates.find(t => t.id === dayDetail.stored!.templateId) ?? null;
    if (dayDetail.programDay && dayDetail.programDay.templateId !== 'rest') {
      return templates.find(t => t.id === dayDetail.programDay!.templateId) ?? null;
    }
    return null;
  }, [dayDetail, templates]);

  const handleOpenScheduled = () => {
    if (dayDetail.stored) {
      onOpenFutureWorkout(dayDetail.stored);
      return;
    }
    if (dayDetail.programDay) {
      const synthetic: FutureWorkout = {
        id: `synthetic-${dayDetail.dateStr}`,
        programId: 'manual',
        date: dayDetail.dateStr,
        templateId: dayDetail.programDay.templateId,
        label: dayDetail.programDay.label,
      };
      onOpenFutureWorkout(synthetic);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onBack}
          className="p-2 -ml-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">📅 Calendar</h1>
      </div>

      <div className="bg-card rounded-xl border border-border p-2 mb-4">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => d && setSelected(d)}
          month={month}
          onMonthChange={setMonth}
          weekStartsOn={1}
          modifiers={{
            completedWorkout,
            completedRest,
            scheduledWorkout,
            scheduledRest,
          }}
          modifiersClassNames={{
            completedWorkout: 'bg-green-500/25 text-foreground font-bold',
            completedRest: 'bg-blue-500/20 text-foreground',
            scheduledWorkout: 'ring-1 ring-primary/60',
            scheduledRest: 'ring-1 ring-blue-500/40',
          }}
          className={cn('p-3 pointer-events-auto w-full')}
        />
        {/* Legend */}
        <div className="flex flex-wrap gap-3 px-3 pb-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500/50" /> Done</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500/40" /> Rest</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded ring-1 ring-primary/60" /> Scheduled</span>
        </div>
      </div>

      {/* Day Detail */}
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">
          {format(selected, 'EEEE, MMM d')}
        </p>

        {dayDetail.sessions.length > 0 && (
          <div className="space-y-2">
            {dayDetail.sessions.map(s => (
              <button
                key={s.id}
                onClick={() => onOpenSession(s)}
                className="w-full text-left bg-secondary/50 hover:bg-secondary rounded-lg p-3 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-foreground">
                    {s.isRestDay ? '😴 Rest Day' : '✅ Workout'}
                  </span>
                  {!s.isRestDay && (
                    <span className="text-xs text-muted-foreground">
                      {Math.floor(s.duration / 60)} min · {s.totalSets} sets
                    </span>
                  )}
                </div>
                {!s.isRestDay && s.exercises.length > 0 && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {s.exercises.map(e => lookup[e.exerciseId] ?? e.exerciseName ?? 'Exercise').join(' → ')}
                  </p>
                )}
                {s.isRestDay && s.recoveryActivities && s.recoveryActivities.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {s.recoveryActivities
                      .map(r => RECOVERY_ACTIVITIES.find(a => a.id === r.activityId)?.name ?? 'Recovery')
                      .join(', ')}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}

        {dayDetail.sessions.length === 0 && (dayDetail.stored || dayDetail.programDay) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">
                {(dayDetail.stored?.templateId === 'rest' || dayDetail.programDay?.templateId === 'rest')
                  ? '😴 Rest Day'
                  : `🏋️ ${dayDetail.stored?.label ?? dayDetail.programDay?.label ?? 'Workout'}`}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-primary font-bold">Scheduled</span>
            </div>
            {selectedTemplate && (
              <p className="text-xs text-muted-foreground line-clamp-3">
                {selectedTemplate.exercises.map(e => lookup[e.exerciseId] ?? 'Exercise').join(' → ')}
              </p>
            )}
            <div className="flex gap-2">
              {selectedTemplate ? (
                <>
                  <Button variant="neon" size="sm" onClick={() => onStartTemplate(selectedTemplate)}>
                    Start
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleOpenScheduled}>
                    Details
                  </Button>
                </>
              ) : (
                <Button variant="neon" size="sm" onClick={handleOpenScheduled}>
                  Open
                </Button>
              )}
            </div>
          </div>
        )}

        {dayDetail.sessions.length === 0 && !dayDetail.stored && !dayDetail.programDay && (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm text-muted-foreground">Nothing planned for this day.</p>
            <Button variant="outline" size="sm" onClick={() => onAddRestDay(dayDetail.dateStr)}>
              😴 Add Rest Day
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
