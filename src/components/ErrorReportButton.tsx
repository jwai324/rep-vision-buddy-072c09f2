import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bug, Mic, Send, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useSpeechToText, type SpeechToTextError } from '@/hooks/useSpeechToText';
import { SPEECH_ERROR_MESSAGES, withSpoken } from '@/utils/speechToText';
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

/** The two boxes that can be dictated into, and the caps they hold text to. */
type VoiceField = 'description' | 'expected';
const FIELD_LIMIT: Record<VoiceField, number> = {
  description: MAX_DESCRIPTION_CHARS,
  expected: MAX_EXPECTED_CHARS,
};
const FIELD_LABEL: Record<VoiceField, string> = {
  description: 'What happened',
  expected: 'What should happen instead',
};

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

  // Which box a voice run writes into. One engine serves both: the browser runs
  // one recognizer at a time, and a single run is what keeps a sentence from
  // being split across two boxes. `description` and `expected` hold what was
  // typed; while a run is on, the box it opened on shows the two composed at
  // render time, so what is on screen is the whole of what the engine has
  // heard. The run hands its words over once, and they become ordinary text.
  const [voiceField, setVoiceField] = useState<VoiceField | null>(null);
  // A mic tapped on the other box while a run is on: that run ends first and
  // the queued box opens once its words have been handed over.
  const queuedField = useRef<VoiceField | null>(null);

  const speech = useSpeechToText({
    onEnd: useCallback(
      (words: string) => {
        // The field this run opened on: it only ever changes once a run has
        // finished handing its words over (see the hand-off effect below).
        if (!voiceField) return;
        const apply = voiceField === 'expected' ? setExpected : setDescription;
        apply(prev => withSpoken(prev, words, FIELD_LIMIT[voiceField]));
      },
      [voiceField],
    ),
    onError: useCallback((error: SpeechToTextError) => toast.error(SPEECH_ERROR_MESSAGES[error.reason]), []),
  });
  const { listening, transcript, supported, start: startListening, stop: stopListening, cancel: cancelListening } = speech;

  const descriptionValue = withSpoken(
    description,
    voiceField === 'description' ? transcript : '',
    MAX_DESCRIPTION_CHARS,
  );
  const expectedValue = withSpoken(expected, voiceField === 'expected' ? transcript : '', MAX_EXPECTED_CHARS);

  // The queued box opens only once the run before it is completely done.
  // `listening` goes false the moment the mic button ends a run, but its words
  // are still with the engine until the phrase in flight finalizes, and the
  // field they are destined for must not change under them.
  useEffect(() => {
    const next = queuedField.current;
    if (!next || listening || transcript) return;
    queuedField.current = null;
    setVoiceField(next);
    startListening();
  }, [listening, transcript, startListening]);

  // Leaving the microphone live behind a dismissed sheet would give no sign it
  // was still recording; stopping folds the words into the persisted draft.
  useEffect(() => {
    if (!open) {
      queuedField.current = null;
      stopListening();
    }
  }, [open, stopListening]);

  const handleMic = (field: VoiceField) => {
    if (navigator.vibrate) navigator.vibrate(5);
    if (listening) {
      // Ending the run hands its words to the box it opened on; a tap on the
      // other box's mic queues that box to open next.
      queuedField.current = voiceField === field ? null : field;
      stopListening();
      return;
    }
    queuedField.current = null;
    setVoiceField(field);
    startListening();
  };

  const editField = (field: VoiceField, next: string) => {
    if (field === 'expected') setExpected(next);
    else setDescription(next);
    // The box already shows everything spoken so far, so the edited text is the
    // new baseline and the run's words are dropped rather than handed over on
    // top of it. Typing takes over from talking — in that box only.
    if (voiceField === field) {
      queuedField.current = null;
      cancelListening();
    }
  };

  const micFor = (field: VoiceField) =>
    supported ? { listening: listening && voiceField === field, onToggle: () => handleMic(field) } : undefined;

  const canSubmit = descriptionValue.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    // The spoken words go out with the report, so they are banked as ordinary
    // text first and the run is dropped rather than handed over on top of it —
    // a failed send has to keep everything the user could see.
    setDescription(descriptionValue);
    setExpected(expectedValue);
    queuedField.current = null;
    cancelListening();
    const ok = await submitReport({ kind, description: descriptionValue, expected: expectedValue, screen });
    if (!ok) {
      toast.error("Couldn't send the report. Check your connection and try again — your text is kept.");
      return;
    }
    toast.success('Reported. It goes into the fix queue tonight.');
    setDescription('');
    setExpected('');
    setKind('bug');
    setOpen(false);
  }, [canSubmit, cancelListening, submitReport, kind, descriptionValue, expectedValue, screen]);

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

            <DictatedField
              field="description"
              value={descriptionValue}
              onChange={editField}
              rows={4}
              placeholder="What happened? Say what you tapped and what you saw."
              mic={micFor('description')}
            />
            <DictatedField
              field="expected"
              value={expectedValue}
              onChange={editField}
              rows={2}
              placeholder="What should happen instead? (optional)"
              mic={micFor('expected')}
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

interface DictatedFieldProps {
  field: VoiceField;
  value: string;
  onChange: (field: VoiceField, next: string) => void;
  rows: number;
  placeholder: string;
  /** Absent on a browser with no recognizer — the box is then a plain one. */
  mic?: { listening: boolean; onToggle: () => void };
}

/** A report box with the mic button the AI coach's composer uses, in-corner. */
const DictatedField: React.FC<DictatedFieldProps> = ({ field, value, onChange, rows, placeholder, mic }) => {
  const label = FIELD_LABEL[field];
  return (
    <div className="relative">
      <Textarea
        aria-label={label}
        value={value}
        onChange={e => onChange(field, e.target.value.slice(0, FIELD_LIMIT[field]))}
        maxLength={FIELD_LIMIT[field]}
        rows={rows}
        placeholder={placeholder}
        className={cn('resize-none', mic && 'pr-12')}
      />
      {mic && (
        <button
          type="button"
          onClick={mic.onToggle}
          aria-label={`${mic.listening ? 'Stop' : 'Start'} voice input for ${label}`}
          aria-pressed={mic.listening}
          className={cn(
            'absolute right-2 bottom-2 w-9 h-9 rounded-lg flex items-center justify-center transition-all',
            mic.listening
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/40'
              : 'bg-secondary text-foreground hover:bg-secondary/70 hover:text-primary',
          )}
        >
          {mic.listening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-4 h-4" />}
        </button>
      )}
      {mic?.listening && (
        <p className="mt-1 flex items-center gap-2 text-[11px] text-primary">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          Listening — tap the mic or pause when you're done
        </p>
      )}
    </div>
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
