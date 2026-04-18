import React, { useMemo, useState } from 'react';
import { Settings, BarChart3 } from 'lucide-react';
import { BODY_PARTS } from '@/data/exercises';
import type { WorkoutSession, WorkoutProgram, WorkoutTemplate, DayFrequency, FutureWorkout } from '@/types/workout';
import { EXERCISES } from '@/types/workout';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { Button } from '@/components/ui/button';
import { addDays, addWeeks, format, getDay, isSameDay, startOfWeek } from 'date-fns';
import { parseLocalDate } from '@/utils/dateUtils';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';

interface DashboardProps {
  history: WorkoutSession[];
  activeProgram: WorkoutProgram | null;
  templates: WorkoutTemplate[];
  futureWorkouts: FutureWorkout[];
  onStartWorkout: () => void;
  onGoToFutureWorkouts: () => void;
  onStartTemplate: (template: WorkoutTemplate) => void;
  onGoToHistory: () => void;
  onGoToTemplates: () => void;
  onGoToPrograms: () => void;
  onBrowseExercises: () => void;
  onGoToSettings: () => void;
  onGoToAnalytics: () => void;
  onBuildAIProgram: () => void;
  onAddRestDay: () => void;
  onDayClick: (date: Date, template: WorkoutTemplate | null) => void;
  onGoToMonthlyCalendar: () => void;
}

function getStreak(sessions: WorkoutSession[]): number {
  if (sessions.length === 0) return 0;
  let streak = 0;
  const today = format(new Date(), 'yyyy-MM-dd');

  // Build a set of workout date strings for fast lookup
  const workoutDates = new Set(
    sessions.map(s => format(parseLocalDate(s.date), 'yyyy-MM-dd'))
  );

  for (let i = 0; i < 365; i++) {
    const d = addDays(new Date(today + 'T00:00:00'), -i);
    const dayStr = format(d, 'yyyy-MM-dd');
    if (workoutDates.has(dayStr)) streak++;
    else if (i > 0) break;
    else continue;
  }
  return streak;
}

function formatDuration(s: number) {
  const m = Math.floor(s / 60);
  return `${m} min`;
}

const BODY_PART_COLORS: Record<string, string> = {
  Chest: 'bg-red-500/80',
  Back: 'bg-blue-500/80',
  Shoulders: 'bg-orange-500/80',
  Biceps: 'bg-purple-500/80',
  Triceps: 'bg-pink-500/80',
  Legs: 'bg-emerald-500/80',
  Core: 'bg-yellow-500/80',
  Glutes: 'bg-rose-500/80',
  Forearms: 'bg-teal-500/80',
  Calves: 'bg-cyan-500/80',
};

const HIDDEN_BODY_PARTS = new Set(['Full Body', 'Cardio', 'Neck', 'Forearms']);
const ALL_BODY_PARTS = BODY_PARTS.filter(bp => bp !== 'All' && !HIDDEN_BODY_PARTS.has(bp));

const WeeklySetsByBodyPart: React.FC<{ history: WorkoutSession[] }> = ({ history }) => {
  const { exercises: customExercises } = useCustomExercisesContext();
  const exerciseBodyPartMap = useMemo(() => {
    const map = new Map(EXERCISE_DATABASE.map(ex => [ex.id, ex.primaryBodyPart]));
    for (const ce of customExercises) map.set(ce.id, ce.primaryBodyPart);
    return map;
  }, [customExercises]);
  const [weekOffset, setWeekOffset] = useState(0);

  const { weeklyData, weekLabel } = useMemo(() => {
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
    const weekStart = addDays(monday, weekOffset * 7);
    const weekEnd = addDays(weekStart, 6);
    const startStr = format(weekStart, 'yyyy-MM-dd');
    const endStr = format(weekEnd, 'yyyy-MM-dd');

    const counts: Record<string, number> = {};
    let totalSets = 0;

    for (const session of history) {
      const sessionDate = session.date.length >= 10 ? session.date.substring(0, 10) : format(new Date(session.date), 'yyyy-MM-dd');
      if (sessionDate < startStr || sessionDate > endStr) continue;
      for (const ex of session.exercises) {
        const bodyPart = exerciseBodyPartMap.get(ex.exerciseId) || 'Other';
        const setCount = ex.sets.filter(s => s.type !== 'warmup').length;
        if (setCount === 0) continue;
        counts[bodyPart] = (counts[bodyPart] || 0) + setCount;
        totalSets += setCount;
      }
    }

    const displayedSets = ALL_BODY_PARTS.reduce((sum, bp) => sum + (counts[bp] || 0), 0);

    const label = weekStart.getMonth() === weekEnd.getMonth()
      ? `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'd')}`
      : `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d')}`;

    return { weeklyData: { counts, totalSets, displayedSets }, weekLabel: label };
  }, [history, weekOffset]);

  return (
    <div className="bg-card rounded-xl p-4 border border-border">
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Weekly Sets</p>
        <span className="text-xs font-bold text-primary">{weeklyData.displayedSets} total</span>
      </div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setWeekOffset(o => o - 1)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-muted-foreground">{weekLabel}</span>
        <button
          onClick={() => setWeekOffset(o => o + 1)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
        {ALL_BODY_PARTS.map(bp => {
          const sets = weeklyData.counts[bp] || 0;
          const colorClass = sets === 0 ? 'text-muted-foreground/50'
            : (sets <= 5 || sets >= 20) ? 'text-red-400'
            : (sets <= 8 || sets >= 17) ? 'text-yellow-400'
            : 'text-green-400';
          return (
            <div key={bp} className="flex items-center justify-between">
              <span className={`text-xs truncate ${colorClass}`}>{bp}</span>
              <span className={`text-xs font-mono font-bold ml-1 ${colorClass}`}>{sets}</span>
            </div>
          );
        })}
      </div>
      {weekOffset !== 0 && (
        <div className="flex justify-start mt-2">
          <button
            onClick={() => setWeekOffset(0)}
            className="text-[10px] text-primary font-medium hover:underline"
          >
            Back to this week
          </button>
        </div>
      )}
    </div>
  );
};

// Build all scheduled events from a program's days + frequencies + duration
function buildProgramEvents(program: WorkoutProgram) {
  const events: { date: Date; label: string; templateId: string }[] = [];
  const start = program.startDate ? new Date(program.startDate + 'T00:00:00') : new Date();
  const endDate = addWeeks(start, program.durationWeeks ?? 8);

  program.days.forEach((day) => {
    if (!day.frequency) return;
    const freq = day.frequency;

    if (freq.type === 'weekly') {
      const targetDay = freq.weekday;
      const currentDay = getDay(start);
      const diff = (targetDay - currentDay + 7) % 7;
      let current = addDays(start, diff);
      while (current < endDate) {
        events.push({ date: new Date(current), label: day.label, templateId: day.templateId });
        current = addDays(current, 7);
      }
    } else if (freq.type === 'everyNDays') {
      const origin = freq.startDate ? parseLocalDate(freq.startDate) : new Date(start);
      let current = new Date(origin);
      while (current < endDate) {
        if (current >= start) {
          events.push({ date: new Date(current), label: day.label, templateId: day.templateId });
        }
        current = addDays(current, freq.interval);
      }
    } else if (freq.type === 'monthly') {
      let current = new Date(start);
      current.setDate(freq.dayOfMonth);
      if (current < start) current.setMonth(current.getMonth() + 1);
      while (current < endDate) {
        events.push({ date: new Date(current), label: day.label, templateId: day.templateId });
        const next = new Date(current);
        next.setMonth(next.getMonth() + 1);
        current = next;
      }
    }
  });

  return events;
}

const WeeklyProgramCalendar: React.FC<{
  program: WorkoutProgram | null;
  templates: WorkoutTemplate[];
  history: WorkoutSession[];
  futureWorkouts: FutureWorkout[];
  onDayClick: (date: Date, template: WorkoutTemplate | null) => void;
  onTitleClick?: () => void;
}> = ({ program, templates, history, futureWorkouts, onDayClick, onTitleClick }) => {
  const today = new Date();
  const [weekOffset, setWeekOffset] = useState(0);

  const weekDays = useMemo(() => {
    const mondayOfThisWeek = startOfWeek(today, { weekStartsOn: 1 });
    const start = addDays(mondayOfThisWeek, weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [weekOffset]);

  const events = useMemo(() => program ? buildProgramEvents(program) : [], [program]);

  const weekSchedule = useMemo(() => {
    return weekDays.map(day => {
      const dayEvents = events.filter(e => isSameDay(e.date, day));
      return { date: day, events: dayEvents };
    });
  }, [weekDays, events]);

  const weekLabel = useMemo(() => {
    const first = weekDays[0];
    const last = weekDays[6];
    if (first.getMonth() === last.getMonth()) {
      return `${format(first, 'MMM d')} – ${format(last, 'd')}`;
    }
    return `${format(first, 'MMM d')} – ${format(last, 'MMM d')}`;
  }, [weekDays]);

  return (
    <div className="bg-card rounded-xl p-4 border border-border">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onTitleClick}
          disabled={!onTitleClick}
          className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground font-bold hover:text-primary transition-colors disabled:cursor-default disabled:hover:text-muted-foreground"
        >
          📅 {program?.name ?? 'Calendar'}
          {onTitleClick && <ChevronRight className="w-3 h-3" />}
        </button>
      </div>
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setWeekOffset(o => o - 1)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-muted-foreground">{weekLabel}</span>
        <button
          onClick={() => setWeekOffset(o => o + 1)}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weekSchedule.map((day, i) => {
          const isDayToday = isSameDay(day.date, today);
          const dayStr = format(day.date, 'yyyy-MM-dd');

          // Check completed sessions for this day
          const completedSessions = history.filter(s => {
            return format(parseLocalDate(s.date), 'yyyy-MM-dd') === dayStr;
          });
          const hasCompletedWorkout = completedSessions.some(s => !s.isRestDay);
          const hasCompletedRest = completedSessions.some(s => s.isRestDay);

          // Check future workouts for this day
          const dayFutureWorkouts = futureWorkouts.filter(f => f.date === dayStr);
          const hasScheduledWorkout = dayFutureWorkouts.some(f => f.templateId !== 'rest');
          const hasScheduledRest = dayFutureWorkouts.some(f => f.templateId === 'rest');

          // Program events (for label)
          const hasWorkout = day.events.some(e => e.templateId !== 'rest');
          const isRest = day.events.some(e => e.templateId === 'rest');

          const template = hasWorkout
            ? templates.find(t => day.events.find(e => e.templateId === t.id))
            : null;

          // Determine background & icon
          const bgClass = hasCompletedWorkout ? 'bg-green-500/20'
            : hasCompletedRest ? 'bg-blue-500/10'
            : hasScheduledWorkout || hasWorkout ? 'bg-primary/15'
            : hasScheduledRest || isRest ? 'bg-blue-500/15'
            : 'bg-secondary/50';

          const icon = hasCompletedWorkout ? '✅'
            : hasCompletedRest ? '😴'
            : hasScheduledWorkout || hasWorkout ? '🏋️'
            : hasScheduledRest || isRest ? '😴'
            : '—';

          const label = hasCompletedWorkout
            ? `${completedSessions.filter(s => !s.isRestDay).length} done`
            : hasScheduledWorkout
              ? dayFutureWorkouts.find(f => f.templateId !== 'rest')?.label
              : hasWorkout
                ? day.events.find(e => e.templateId !== 'rest')?.label
                : null;

          return (
            <button
              key={i}
              onClick={() => onDayClick(day.date, template ?? null)}
              className={`flex flex-col items-center rounded-lg py-2 px-1 transition-colors ${
                isDayToday ? 'ring-2 ring-primary' : ''
              } ${bgClass}`}
            >
              <span className={`text-[10px] font-medium ${
                isDayToday ? 'text-primary' : 'text-muted-foreground'
              }`}>
                {format(day.date, 'EEE')}
              </span>
              <span className={`text-sm font-bold ${
                isDayToday ? 'text-foreground' : 'text-muted-foreground'
              }`}>
                {format(day.date, 'd')}
              </span>
              <span className="text-base mt-0.5">{icon}</span>
              {label && (
                <span className={`text-[8px] font-medium truncate max-w-full mt-0.5 ${
                  hasCompletedWorkout ? 'text-green-400' : 'text-primary'
                }`}>
                  {label}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {weekOffset !== 0 && (
        <div className="flex justify-start mt-2">
          <button
            onClick={() => setWeekOffset(0)}
            className="text-[10px] text-primary font-medium hover:underline"
          >
            Back to this week
          </button>
        </div>
      )}
    </div>
  );
};

export const Dashboard: React.FC<DashboardProps> = ({
  history, activeProgram, templates, futureWorkouts, onStartWorkout, onGoToFutureWorkouts, onStartTemplate, onGoToHistory, onGoToTemplates, onGoToPrograms, onBrowseExercises, onGoToSettings, onGoToAnalytics, onBuildAIProgram, onAddRestDay, onDayClick, onGoToMonthlyCalendar
}) => {
  const streak = getStreak(history);
  const exerciseLookup = useExerciseLookup();
  const lastSession = history[0];

  // Determine today's template from active program
  const dayOfWeek = new Date().getDay(); // 0=Sun
  const todayDay = activeProgram?.days[(dayOfWeek + 6) % 7]; // Mon=0
  const todayTemplate = todayDay && todayDay.templateId !== 'rest'
    ? templates.find(t => t.id === todayDay.templateId)
    : null;

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">RepVision</h1>
          <p className="text-sm text-muted-foreground">AI-Powered Workout Tracker</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <span className="text-2xl">🔥</span>
            <span className="font-mono text-xl font-bold text-primary">{streak}</span>
          </div>
          <button
            onClick={onGoToSettings}
            className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Active program today */}
      {todayTemplate && (
        <div className="bg-card rounded-xl p-4 border border-primary/30 glow-green">
          <p className="text-[10px] uppercase tracking-widest text-primary font-bold mb-1">Today's Workout</p>
          <h3 className="font-semibold text-foreground mb-1">{todayTemplate.name}</h3>
          <p className="text-xs text-muted-foreground mb-3">
            {todayTemplate.exercises.map(e => exerciseLookup[e.exerciseId] ?? EXERCISES[e.exerciseId]?.name ?? 'Exercise').join(' → ')}
          </p>
          <Button variant="neon" size="sm" onClick={() => onStartTemplate(todayTemplate)}>
            Start Today's Workout
          </Button>
        </div>
      )}

      {todayDay?.templateId === 'rest' && activeProgram && (
        <div className="bg-card rounded-xl p-4 border border-border text-center">
          <span className="text-2xl">🛏️</span>
          <p className="text-sm text-muted-foreground mt-1">Rest day — recover and grow!</p>
        </div>
      )}

      {/* Weekly Program Calendar */}
      <WeeklyProgramCalendar
        program={activeProgram}
        templates={templates}
        history={history}
        futureWorkouts={futureWorkouts}
        onDayClick={onDayClick}
        onTitleClick={onGoToMonthlyCalendar}
      />


      {/* Weekly Sets by Body Part */}
      <WeeklySetsByBodyPart history={history} />

      {/* Analytics Button */}
      <button
        onClick={onGoToAnalytics}
        className="bg-card rounded-xl p-4 border border-border hover:border-primary/30 transition-colors flex items-center gap-3"
      >
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-foreground">Analytics</p>
          <p className="text-xs text-muted-foreground">Track your volume trends</p>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
      </button>

      {/* AI Program Builder */}
      <Button variant="simulate" size="lg" onClick={onBuildAIProgram} className="w-full text-lg font-bold">
        ✨ Build My Program with AI
      </Button>

      {/* Quick actions */}
      <Button variant="neon" size="lg" onClick={onStartWorkout} className="w-full text-lg font-bold">
        🎯 Start Workout
      </Button>

      <Button variant="outline" size="sm" onClick={onAddRestDay} className="w-full text-muted-foreground">
        😴 Add Rest Day
      </Button>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Templates', icon: '📋', onClick: onGoToTemplates },
          { label: 'Programs', icon: '📅', onClick: onGoToPrograms },
          { label: 'Activity', icon: '📊', onClick: onGoToHistory },
          { label: 'Exercises', icon: '🔍', onClick: onBrowseExercises },
        ].map(item => (
          <button
            key={item.label}
            onClick={item.onClick}
            className="bg-card rounded-xl p-4 flex flex-col items-center gap-2 border border-border hover:border-primary/30 transition-colors"
          >
            <span className="text-2xl">{item.icon}</span>
            <span className="text-xs font-medium text-muted-foreground">{item.label}</span>
          </button>
        ))}
      </div>

    </div>
  );
};
