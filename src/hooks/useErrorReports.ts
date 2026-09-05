import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';
import { APP_VERSION, buildReportContext } from '@/utils/errorReportContext';

type ErrorReportRow = Database['public']['Tables']['error_reports']['Row'];
type ErrorReportInsert = Database['public']['Tables']['error_reports']['Insert'];

export type ErrorReportKind = 'bug' | 'correction' | 'idea';
export type ErrorReportStatus = 'new' | 'fixing' | 'needs_review';

export interface ErrorReportInput {
  kind: ErrorReportKind;
  description: string;
  expected?: string;
  /** Index's `screen.type` — where the user was when they hit Report. */
  screen: string;
}

export interface ErrorReportSummary {
  id: string;
  kind: ErrorReportKind;
  description: string;
  status: ErrorReportStatus;
  triageNotes: string | null;
  createdAt: string;
}

export const MAX_DESCRIPTION_CHARS = 2000;
export const MAX_EXPECTED_CHARS = 1000;

/** `context` is the big column and no list row needs it. */
const LIST_COLUMNS = 'id, kind, description, status, triage_notes, created_at';

function mapReport(
  row: Pick<ErrorReportRow, 'id' | 'kind' | 'description' | 'status' | 'triage_notes' | 'created_at'>,
): ErrorReportSummary {
  return {
    id: row.id,
    kind: row.kind as ErrorReportKind,
    description: row.description,
    status: row.status as ErrorReportStatus,
    triageNotes: row.triage_notes,
    createdAt: row.created_at,
  };
}

/**
 * Lives outside `useStorage` for the same reason shares do: nothing on a cold
 * paint needs the report list, so it is read on demand when the sheet opens
 * rather than mirrored into the localStorage snapshot.
 */
export function useErrorReports() {
  const { user } = useAuth();
  // Keyed on the id, not the user object — see CLAUDE.md on token refreshes.
  const userId = user?.id ?? null;
  const [reports, setReports] = useState<ErrorReportSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const fetchReports = useCallback(async () => {
    if (!userId) {
      setReports([]);
      return;
    }
    const { data, error } = await supabase
      .from('error_reports')
      .select(LIST_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      console.error('[useErrorReports] fetch error:', error);
      return;
    }
    setReports((data ?? []).map(mapReport));
  }, [userId]);

  const submitReport = useCallback(async (input: ErrorReportInput): Promise<boolean> => {
    const description = input.description.trim().slice(0, MAX_DESCRIPTION_CHARS);
    if (!userId || !description) return false;
    const expected = input.expected?.trim().slice(0, MAX_EXPECTED_CHARS) || null;

    const row: ErrorReportInsert = {
      user_id: userId,
      kind: input.kind,
      description,
      expected,
      screen: input.screen,
      route: `${window.location.pathname}${window.location.search}`,
      app_version: APP_VERSION,
      user_agent: navigator.userAgent,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      context: buildReportContext(),
    };

    setSubmitting(true);
    try {
      const { error } = await supabase.from('error_reports').insert(row);
      if (error) {
        console.error('[useErrorReports] insert error:', error);
        return false;
      }
      return true;
    } catch (err) {
      // A gym phone with no signal rejects the fetch outright rather than
      // returning an error object.
      console.error('[useErrorReports] insert failed:', err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }, [userId]);

  return { reports, submitting, fetchReports, submitReport };
}
