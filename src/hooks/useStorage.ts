import { useState, useCallback } from 'react';
import type { WorkoutSession, WorkoutTemplate, WorkoutProgram } from '@/types/workout';

const KEYS = {
  history: 'replog:history',
  templates: 'replog:templates',
  programs: 'replog:programs',
  activeProgram: 'replog:activeProgram',
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

export function useStorage() {
  const [history, setHistory] = useState<WorkoutSession[]>(() => getItem(KEYS.history, []));
  const [templates, setTemplates] = useState<WorkoutTemplate[]>(() => getItem(KEYS.templates, []));
  const [programs, setPrograms] = useState<WorkoutProgram[]>(() => getItem(KEYS.programs, []));
  const [activeProgramId, setActiveProgramId] = useState<string | null>(() => getItem(KEYS.activeProgram, null));

  const saveSession = useCallback((session: WorkoutSession) => {
    setHistory(prev => {
      const next = [session, ...prev];
      setItem(KEYS.history, next);
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
  }, []);

  const deleteProgram = useCallback((id: string) => {
    setPrograms(prev => {
      const next = prev.filter(p => p.id !== id);
      setItem(KEYS.programs, next);
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

  return {
    history, templates, programs, activeProgramId,
    saveSession, saveTemplate, deleteTemplate,
    saveProgram, deleteProgram, setActiveProgram, deleteSession,
  };
}
