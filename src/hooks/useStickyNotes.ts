import { useCallback } from 'react';
import type { UserPreferences } from '@/hooks/useStorage';

/**
 * Persistent sticky notes keyed by exerciseId — stored in Supabase via user preferences.
 * Accepts the stickyNotes record and an updatePreferences callback from useStorage.
 */
export function useStickyNotes(
  stickyNotes: Record<string, string>,
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>,
) {
  const setStickyNote = useCallback((exerciseId: string, text: string) => {
    const next = { ...stickyNotes };
    if (text.trim()) {
      next[exerciseId] = text.trim();
    } else {
      delete next[exerciseId];
    }
    updatePreferences({ stickyNotes: next });
  }, [stickyNotes, updatePreferences]);

  const getStickyNote = useCallback((exerciseId: string) => stickyNotes[exerciseId] ?? '', [stickyNotes]);

  return { getStickyNote, setStickyNote };
}
