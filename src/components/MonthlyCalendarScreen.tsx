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

// Compute every program-scheduled entry for a given date. Programs can put
// multiple ProgramDays on the same weekday, so this returns every match.
function getProgramScheduled(
  date: Date,
  program: WorkoutProgram | null
): { label: string; templateId: string }[] {
  if (!program) return [];
  const start = program.startDate ? parseLocalDate(program.startDate) : new Date();
  const end = addWeeks(start, program.durationWeeks ?? 8);
  if (date < start || date >= end) return [];

  const matches: { label: string; templateId: string }[] = [];
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
    if (match) matches.push({ label: day.label, templateId: day.templateId });
  }
  return matches;
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

  // Only show future workouts tied to the active program (or manually
  // scheduled), so disabled/previous programs don't leak onto the calendar.
  const visibleFutureWorkouts = useMemo(
    () => futureWorkouts.filter(f => f.programId === activeProgram?.id || f.programId === 'manual'),
    [futureWorkouts, activeProgram?.id]
  );

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
    for (const f of visibleFutureWorkouts) {
      const d = parseLocalDate(f.date);
      (f.templateId === 'rest' ? sr : sw).push(d);
    }
    const hasProgramFutureWorkouts = activeProgram && visibleFutureWorkouts.some(f => f.programId === activeProgram.id);
    if (activeProgram && !hasProgramFutureWorkouts) {
      const start = activeProgram.startDate ? parseLocalDate(activeProgram.startDate) : new Date();
      const end = addWeeks(start, activeProgram.durationWeeks ?? 8);
      let cur = new Date(start);
      while (cur < end) {
        const dateStr = format(cur, 'yyyy-MM-dd');
        const hasCompleted = history.some(s => (s.date.length >= 10 ? s.date.substring(0, 10) : s.date) === dateStr);
        const hasStored = visibleFutureWorkouts.some(f => f.date === dateStr);
        if (!hasCompleted && !hasStored) {
          const ps = getProgramScheduled(cur, activeProgram);
          if (ps.some(p => p.templateId !== 'rest')) sw.push(new Date(cur));
          else if (ps.some(p => p.templateId === 'rest')) sr.push(new Date(cur));
        }
        cur = addDays(cur, 1);
      }
    }
    return { completedWorkout: cw, completedRest: cr, scheduledWorkout: sw, scheduledRest: sr };
  }, [history, visibleFutureWorkouts, activeProgram]);

  // Compute selected day content
  const dayDetail = useMemo(() => {
    const dateStr = format(selected, 'yyyy-MM-dd');
    const sessions = history.filter(s => {
      const sd = s.date.length >= 10 ? s.date.substring(0, 10) : s.date;
      return sd === dateStr;
    });
    const stored = visibleFutureWorkouts.filter(f => f.date === dateStr);
    const programDays = !sessions.length && stored.length === 0
      ? getProgramScheduled(selected, activeProgram)
      : [];
    return { dateStr, sessions, stored, programDays };
  }, [selected, history, visibleFutureWorkouts, activeProgram]);

  interface ScheduledEntry {
    key: string;
    label: string;
    templateId: string;
    template: WorkoutTemplate | null;
    openScheduled: () => void;
  }

  const scheduledEntries = useMemo<ScheduledEntry[]>(() => {
    if (dayDetail.stored.length > 0) {
      return dayDetail.stored.map((fw, i) => ({
        key: `stored-${fw.id ?? i}`,
        label: fw.label,
        templateId: fw.templateId,
        template: fw.templateId === 'rest' ? null : templates.find(t => t.id === fw.templateId) ?? null,
        openScheduled: () => onOpenFutureWorkout(fw),
      }));
    }
    return dayDetail.programDays.map((pd, i) => {
      const synthetic: FutureWorkout = {
        id: `synthetic-${dayDetail.dateStr}-${i}`,
        programId: 'manual',
        date: dayDetail.dateStr,
        templateId: pd.templateId,
        label: pd.label,
      };
      return {
        key: `program-${i}`,
        label: pd.label,
        templateId: pd.templateId,
        template: pd.templateId === 'rest' ? null : templates.find(t => t.id === pd.templateId) ?? null,
        openScheduled: () => onOpenFutureWorkout(synthetic),
      };
    });
  }, [dayDetail, templates, onOpenFutureWorkout]);

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

        {dayDetail.sessions.length === 0 && scheduledEntries.length > 0 && (
          <div className="space-y-3">
            {scheduledEntries.map((entry, idx) => (
              <div key={entry.key} className={idx > 0 ? 'pt-3 border-t border-border' : undefined}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">
                    {entry.templateId === 'rest' ? '😴 Rest Day' : `🏋️ ${entry.label}`}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-primary font-bold">
                    {scheduledEntries.length > 1 ? `Scheduled · ${idx + 1}/${scheduledEntries.length}` : 'Scheduled'}
                  </span>
                </div>
                {entry.template && (
                  <p className="text-xs text-muted-foreground line-clamp-3 mt-2">
                    {entry.template.exercises.map(e => lookup[e.exerciseId] ?? 'Exercise').join(' → ')}
                  </p>
                )}
                <div className="flex gap-2 mt-3">
                  {entry.template ? (
                    <>
                      <Button variant="neon" size="sm" onClick={() => onStartTemplate(entry.template!)}>
                        Start
                      </Button>
                      <Button variant="outline" size="sm" onClick={entry.openScheduled}>
                        Details
                      </Button>
                    </>
                  ) : (
                    <Button variant="neon" size="sm" onClick={entry.openScheduled}>
                      Open
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {dayDetail.sessions.length === 0 && scheduledEntries.length === 0 && (
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
