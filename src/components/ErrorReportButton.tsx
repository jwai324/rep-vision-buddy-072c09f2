import React, { useCallback, useEffect, useState } from 'react';
import { Bug, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  useErrorReports,
  MAX_DESCRIPTION_CHARS,
  MAX_EXPECTED_CHARS,
  type ErrorReportKind,
  type ErrorReportStatus,
  type ErrorReportSummary,
} from '@/hooks/useErrorReports';
import { getRecentErrors } from '@/utils/consoleErrorBuffer';

const KINDS: { value: ErrorReportKind; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'correction', label: 'Correction' },
  { value: 'idea', label: 'Idea' },
];

const STATUS_LABEL: Record<ErrorReportStatus, string> = {
  new: 'Queued',
  fixing: 'Being fixed',
  needs_review: 'Needs your call',
};

const DRAFT_STORAGE_KEY = 'error-report-draft';

function readDraft(): string {
  try {
    return localStorage.getItem(DRAFT_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

interface ErrorReportButtonProps {
  /** Index's `screen.type`, attached to the report so it says where the user was. */
  screen: string;
}

/**
 * The "report a problem" handle. It hangs from the top edge of the viewport,
 * centred, and is 24px tall: every screen's header starts at or below 16px
 * with its controls at the left and right edges, so the centre strip is the
 * one place that is free on all of them. The AI coach owns the bottom-right.
 */
export const ErrorReportButton: React.FC<ErrorReportButtonProps> = ({ screen }) => {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ErrorReportKind>('bug');
  const [description, setDescription] = useState(readDraft);
  const [expected, setExpected] = useState('');
  const { reports, submitting, fetchReports, submitReport } = useErrorReports();

  useEffect(() => {
    if (open) fetchReports();
  }, [open, fetchReports]);

  // A half-written report survives a closed sheet or a reload — a gym phone
  // gets interrupted, and a failed send keeps the text for the retry.
  useEffect(() => {
    try {
      if (description) localStorage.setItem(DRAFT_STORAGE_KEY, description);
      else localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // storage unavailable (private mode, quota) — draft just won't persist
    }
  }, [description]);

  const canSubmit = description.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    const ok = await submitReport({ kind, description, expected, screen });
    if (!ok) {
      toast.error("Couldn't send the report. Check your connection and try again — your text is kept.");
      return;
    }
    toast.success('Reported. It goes into the fix queue tonight.');
    setDescription('');
    setExpected('');
    setKind('bug');
    setOpen(false);
  }, [canSubmit, submitReport, kind, description, expected, screen]);

  const recentErrorCount = open ? getRecentErrors().length : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a problem"
        title="Report a problem"
        // The transparent padding widens the tap target without widening the pill.
        className="fixed top-0 left-1/2 -translate-x-1/2 z-40 px-3 pb-2 pt-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-b-xl"
      >
        <span className="flex items-center justify-center h-6 w-11 rounded-b-xl border border-t-0 border-border bg-card/90 backdrop-blur text-muted-foreground shadow-sm transition-colors hover:text-primary hover:border-primary/50">
          <Bug className="w-3.5 h-3.5" />
        </span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85dvh] overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2">
              <Bug className="w-4 h-4 text-primary" />
              Report a problem
            </SheetTitle>
            <SheetDescription>
              Something broken, wrong, or missing? Describe it and it goes straight into the fix queue.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex flex-col gap-3">
            <div role="radiogroup" aria-label="Report type" className="flex gap-2">
              {KINDS.map(k => (
                <button
                  key={k.value}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.value}
                  onClick={() => setKind(k.value)}
                  className={cn(
                    'flex-1 text-sm py-2 rounded-xl border transition-colors',
                    kind === k.value
                      ? 'border-primary bg-primary/15 text-primary font-semibold'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <Textarea
              aria-label="What happened"
              value={description}
              onChange={e => setDescription(e.target.value.slice(0, MAX_DESCRIPTION_CHARS))}
              maxLength={MAX_DESCRIPTION_CHARS}
              rows={4}
              placeholder="What happened? Say what you tapped and what you saw."
              className="resize-none"
            />
            <Textarea
              aria-label="What should happen instead"
              value={expected}
              onChange={e => setExpected(e.target.value.slice(0, MAX_EXPECTED_CHARS))}
              maxLength={MAX_EXPECTED_CHARS}
              rows={2}
              placeholder="What should happen instead? (optional)"
              className="resize-none"
            />

            <p className="text-[11px] text-muted-foreground">
              Attached automatically: screen ({screen}), app version, device, and{' '}
              {recentErrorCount} recent console error{recentErrorCount === 1 ? '' : 's'}.
            </p>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'h-11 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all',
                canSubmit ? 'gradient-green text-primary-foreground' : 'bg-secondary text-muted-foreground',
              )}
            >
              <Send className="w-4 h-4" />
              {submitting ? 'Sending…' : 'Send report'}
            </button>
          </div>

          {reports.length > 0 && (
            <div className="mt-5 border-t border-border pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Your open reports
              </h4>
              <ul className="flex flex-col gap-2">
                {reports.map(r => (
                  <ReportRow key={r.id} report={r} />
                ))}
              </ul>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
};

const ReportRow: React.FC<{ report: ErrorReportSummary }> = ({ report }) => (
  <li className="rounded-lg border border-border bg-card px-3 py-2 text-sm">
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{report.kind}</span>
      <span
        className={cn(
          'text-[10px] font-semibold px-2 py-0.5 rounded-full',
          report.status === 'needs_review' ? 'bg-amber-500/15 text-amber-400' : 'bg-primary/15 text-primary',
        )}
      >
        {STATUS_LABEL[report.status]}
      </span>
    </div>
    <p className="text-foreground mt-1 line-clamp-2">{report.description}</p>
    {report.status === 'needs_review' && report.triageNotes && (
      <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{report.triageNotes}</p>
    )}
  </li>
);
