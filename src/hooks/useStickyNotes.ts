import { useState, useCallback } from 'react';

const STORAGE_KEY = 'replog:stickyNotes';

function loadNotes(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveNotes(notes: Record<string, string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

/** Persistent sticky notes keyed by exerciseId — survive across workout sessions. */
export function useStickyNotes() {
  const [notes, setNotes] = useState<Record<string, string>>(loadNotes);

  const setStickyNote = useCallback((exerciseId: string, text: string) => {
    setNotes(prev => {
      const next = { ...prev };
      if (text.trim()) {
        next[exerciseId] = text.trim();
      } else {
        delete next[exerciseId];
      }
      saveNotes(next);
      return next;
    });
  }, []);

  const getStickyNote = useCallback((exerciseId: string) => notes[exerciseId] ?? '', [notes]);

  return { getStickyNote, setStickyNote };
}
