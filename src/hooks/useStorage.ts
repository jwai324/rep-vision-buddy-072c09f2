import { useState, useCallback } from 'react';
import type { WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import { addDays, addWeeks, getDay, format } from 'date-fns';

const KEYS = {
  history: 'replog:history',
  templates: 'replog:templates',
  programs: 'replog:programs',
  activeProgram: 'replog:activeProgram',
  futureWorkouts: 'replog:futureWorkouts',
} as const;

function getItem<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function setItem<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function generateFutureWorkouts(program: WorkoutProgram): FutureWorkout[] {
  const workouts: FutureWorkout[] = [];
  const start = program.startDate ? new Date(program.startDate) : new Date();
  const endDate = addWeeks(start, program.durationWeeks ?? 8);

  // Track which dates have a scheduled workout
  const scheduledDates = new Set<string>();

  program.days.forEach((day) => {
    if (!day.frequency) return;
    const freq = day.frequency;

    const addEvent = (date: Date) => {
      const dateStr = format(date, 'yyyy-MM-dd');
      scheduledDates.add(dateStr);
      workouts.push({
        id: crypto.randomUUID(),
        programId: program.id,
        date: dateStr,
        templateId: day.templateId,
        label: day.label,
      });
    };

    if (freq.type === 'weekly') {
      const targetDay = freq.weekday;
      const currentDay = getDay(start);
      const diff = (targetDay - currentDay + 7) % 7;
      let current = addDays(start, diff);
      while (current < endDate) {
        addEvent(current);
        current = addDays(current, 7);
      }
    } else if (freq.type === 'everyNDays') {
      let current = new Date(start);
      while (current < endDate) {
        addEvent(current);
        current = addDays(current, freq.interval);
      }
    } else if (freq.type === 'monthly') {
      let current = new Date(start);
      current.setDate(freq.dayOfMonth);
      if (current < start) current.setMonth(current.getMonth() + 1);
      while (current < endDate) {
        addEvent(current);
        const next = new Date(current);
        next.setMonth(next.getMonth() + 1);
        current = next;
      }
    }
  });

  // Fill in rest days for any unscheduled dates in the program range
  let cursor = new Date(start);
  while (cursor < endDate) {
    const dateStr = format(cursor, 'yyyy-MM-dd');
    if (!scheduledDates.has(dateStr)) {
      workouts.push({
        id: crypto.randomUUID(),
        programId: program.id,
        date: dateStr,
        templateId: 'rest',
        label: 'Rest Day',
      });
    }
    cursor = addDays(cursor, 1);
  }

  return workouts;
}

function cleanFutureWorkouts(workouts: FutureWorkout[], history: WorkoutSession[]): FutureWorkout[] {
  const today = format(new Date(), 'yyyy-MM-dd');
  return workouts.filter(fw => {
    if (fw.date < today) return false;
    if (fw.completed) return false;
    // Check if a session was completed on that date with matching template
    const completedOnDate = history.some(s => s.date.split('T')[0] === fw.date);
    if (completedOnDate) return false;
    return true;
  });
}

export function useStorage() {
  const [history, setHistory] = useState<WorkoutSession[]>(() => getItem(KEYS.history, []));
  const [templates, setTemplates] = useState<WorkoutTemplate[]>(() => getItem(KEYS.templates, []));
  const [programs, setPrograms] = useState<WorkoutProgram[]>(() => getItem(KEYS.programs, []));
  const [activeProgramId, setActiveProgramId] = useState<string | null>(() => getItem(KEYS.activeProgram, null));
  const [futureWorkouts, setFutureWorkouts] = useState<FutureWorkout[]>(() => {
    const stored = getItem<FutureWorkout[]>(KEYS.futureWorkouts, []);
    const historyData = getItem<WorkoutSession[]>(KEYS.history, []);
    const cleaned = cleanFutureWorkouts(stored, historyData);
    if (cleaned.length !== stored.length) setItem(KEYS.futureWorkouts, cleaned);
    return cleaned;
  });

  const saveSession = useCallback((session: WorkoutSession) => {
    setHistory(prev => {
      const next = [session, ...prev];
      setItem(KEYS.history, next);
      // Clean future workouts when a session is saved
      setFutureWorkouts(fws => {
        const cleaned = cleanFutureWorkouts(fws, next);
        setItem(KEYS.futureWorkouts, cleaned);
        return cleaned;
      });
      return next;
    });
  }, []);

  const saveTemplate = useCallback((template: WorkoutTemplate) => {
    setTemplates(prev => {
      const exists = prev.findIndex(t => t.id === template.id);
      const next = exists >= 0 ? prev.map(t => t.id === template.id ? template : t) : [...prev, template];
      setItem(KEYS.templates, next);
      return next;
    });
  }, []);

  const deleteTemplate = useCallback((id: string) => {
    setTemplates(prev => {
      const next = prev.filter(t => t.id !== id);
      setItem(KEYS.templates, next);
      return next;
    });
  }, []);

  const saveProgram = useCallback((program: WorkoutProgram) => {
    setPrograms(prev => {
      const exists = prev.findIndex(p => p.id === program.id);
      const next = exists >= 0 ? prev.map(p => p.id === program.id ? program : p) : [...prev, program];
      setItem(KEYS.programs, next);
      return next;
    });
    // Generate future workouts for this program
    setFutureWorkouts(prev => {
      const withoutOld = prev.filter(fw => fw.programId !== program.id);
      const newFws = generateFutureWorkouts(program);
      const historyData = getItem<WorkoutSession[]>(KEYS.history, []);
      const cleaned = cleanFutureWorkouts([...withoutOld, ...newFws], historyData);
      setItem(KEYS.futureWorkouts, cleaned);
      return cleaned;
    });
  }, []);

  const deleteProgram = useCallback((id: string) => {
    setPrograms(prev => {
      const next = prev.filter(p => p.id !== id);
      setItem(KEYS.programs, next);
      return next;
    });
    // Remove future workouts for this program
    setFutureWorkouts(prev => {
      const next = prev.filter(fw => fw.programId !== id);
      setItem(KEYS.futureWorkouts, next);
      return next;
    });
  }, []);

  const setActiveProgram = useCallback((id: string | null) => {
    setActiveProgramId(id);
    setItem(KEYS.activeProgram, id);
  }, []);

  const deleteSession = useCallback((id: string) => {
    setHistory(prev => {
      const next = prev.filter(s => s.id !== id);
      setItem(KEYS.history, next);
      return next;
    });
  }, []);

  const updateFutureWorkout = useCallback((updated: FutureWorkout) => {
    setFutureWorkouts(prev => {
      const exists = prev.some(fw => fw.id === updated.id);
      const next = exists
        ? prev.map(fw => fw.id === updated.id ? updated : fw)
        : [...prev, updated];
      setItem(KEYS.futureWorkouts, next);
      return next;
    });
  }, []);

  return {
    history, templates, programs, activeProgramId, futureWorkouts,
    saveSession, saveTemplate, deleteTemplate,
    saveProgram, deleteProgram, setActiveProgram, deleteSession, updateFutureWorkout,
  };
}
