import React, { useState } from 'react';
import { Check, X, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EXERCISE_DATABASE } from '@/data/exercises';
import type { Proposal, ProposalSnapshot, SessionExerciseRow } from '@/contexts/ChatContext';

const EX_BY_ID = new Map(EXERCISE_DATABASE.map(e => [e.id, e]));

interface Props {
  proposal: Proposal;
  templateNameById: Record<string, string>;
  onApply: (id: string) => void;
  onDiscard: (id: string) => void;
}

const exerciseName = (id: string) => EX_BY_ID.get(id)?.name || id;

type DiffMark = 'add' | 'remove' | 'change' | 'same';

const markClass: Record<DiffMark, string> = {
  add: 'text-primary border-l-2 border-primary/60 pl-2 bg-primary/5',
  remove: 'text-destructive line-through border-l-2 border-destructive/60 pl-2 bg-destructive/5',
  change: 'text-amber-500 border-l-2 border-amber-500/60 pl-2 bg-amber-500/5',
  same: 'text-muted-foreground border-l-2 border-transparent pl-2',
};

const formatExerciseRow = (e: { exerciseId: string; sets?: number; targetReps?: number; restSeconds?: number }) => {
  const name = exerciseName(e.exerciseId);
  const sets = e.sets ?? '—';
  const reps = e.targetReps ?? '—';
  const rest = e.restSeconds != null ? ` · rest ${e.restSeconds}s` : '';
  return `${name} · ${sets}×${reps}${rest}`;
};

const TemplateDiff: React.FC<{ before: ProposalSnapshot; after: ProposalSnapshot }> = ({ before, after }) => {
  if (before.kind !== 'template' || after.kind !== 'template') return null;
  const beforeEx = before.template?.exercises || [];
  const afterEx = after.template?.exercises || [];

  if (!before.template && after.template) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">New template "{after.template.name}"</div>
        {afterEx.map((e, i) => (
          <div key={i} className={cn('text-xs py-0.5', markClass.add)}>+ {formatExerciseRow(e)}</div>
        ))}
      </div>
    );
  }

  if (before.template && !after.template) {
    return (
      <div className="space-y-1">
        <div className="text-[11px] uppercase tracking-wide text-destructive">Delete "{before.template.name}"</div>
        {beforeEx.map((e: any, i: number) => (
          <div key={i} className={cn('text-xs py-0.5', markClass.remove)}>− {formatExerciseRow(e)}</div>
        ))}
      </div>
    );
  }

  const beforeIds = new Set(beforeEx.map((e: any) => e.exerciseId));
  const afterIds = new Set(afterEx.map((e: any) => e.exerciseId));

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Edit "{after.template?.name}"</div>
      {beforeEx.map((e: any, i: number) =>
        !afterIds.has(e.exerciseId)
          ? <div key={'r-' + i} className={cn('text-xs py-0.5', markClass.remove)}>− {formatExerciseRow(e)}</div>
          : null
      )}
      {afterEx.map((e: any, i: number) => {
        if (!beforeIds.has(e.exerciseId)) {
          return <div key={'a-' + i} className={cn('text-xs py-0.5', markClass.add)}>+ {formatExerciseRow(e)}</div>;
        }
        const matching = beforeEx.find((b: any) => b.exerciseId === e.exerciseId);
        const changed = matching && (matching.sets !== e.sets || matching.targetReps !== e.targetReps || matching.restSeconds !== e.restSeconds);
        return (
          <div key={'k-' + i} className={cn('text-xs py-0.5', changed ? markClass.change : markClass.same)}>
            {changed ? '~ ' : '  '}{formatExerciseRow(e)}
          </div>
        );
      })}
    </div>
  );
};

const ProgramDiff: React.FC<{ before: ProposalSnapshot; after: ProposalSnapshot; templateNameById: Record<string, string> }> = ({ before, after, templateNameById }) => {
  if (before.kind !== 'program' || after.kind !== 'program') return null;
  const [expanded, setExpanded] = useState(false);
  const beforeDays = before.program?.days || [];
  const afterDays = after.program?.days || [];

  const renderDay = (d: any, mark: DiffMark) => {
    const templateName = d.templateId === 'rest' ? 'rest' : (templateNameById[d.templateId] || d.templateId);
    return `${d.label || '—'} → ${templateName}`;
  };

  let header: React.ReactNode;
  let body: { day: any; mark: DiffMark }[] = [];

  if (!before.program && after.program) {
    header = <div className="text-[11px] uppercase tracking-wide text-muted-foreground">New program "{after.program.name}" ({afterDays.length} days)</div>;
    body = afterDays.map((d: any) => ({ day: d, mark: 'add' }));
  } else if (before.program && !after.program) {
    header = <div className="text-[11px] uppercase tracking-wide text-destructive">Delete "{before.program.name}"</div>;
    body = beforeDays.map((d: any) => ({ day: d, mark: 'remove' }));
  } else {
    header = <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Edit program</div>;
    body = afterDays.map((d: any) => ({ day: d, mark: 'same' as DiffMark }));
  }

  const collapsed = body.length > 4 && !expanded;
  const visible = collapsed ? body.slice(0, 3) : body;

  return (
    <div className="space-y-1">
      {header}
      {visible.map((row, i) => (
        <div key={i} className={cn('text-xs py-0.5', markClass[row.mark])}>
          {row.mark === 'add' ? '+ ' : row.mark === 'remove' ? '− ' : '  '}{renderDay(row.day, row.mark)}
        </div>
      ))}
      {body.length > 4 && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? 'Hide' : `Show ${body.length - 3} more`}
        </button>
      )}
    </div>
  );
};

const ActiveProgramDiff: React.FC<{ before: ProposalSnapshot; after: ProposalSnapshot }> = ({ before, after }) => {
  if (before.kind !== 'active-program' || after.kind !== 'active-program') return null;
  return (
    <div className="text-xs">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Active program</div>
      <span className={markClass.remove + ' inline-block py-0.5'}>{before.programName || '(none)'}</span>
      <span className="text-muted-foreground"> → </span>
      <span className={markClass.add + ' inline-block py-0.5'}>{after.programName || '(none)'}</span>
    </div>
  );
};

const formatSetSummary = (sets: SessionExerciseRow['sets']) => {
  if (!sets.length) return '0 sets';
  const parts = sets.map(s => {
    const w = s.weight != null ? `${s.weight}` : '—';
    const r = s.reps != null ? `${s.reps}` : '—';
    return `${w}×${r}`;
  });
  return parts.join(', ');
};

const SessionDiff: React.FC<{ proposal: Proposal }> = ({ proposal }) => {
  if (proposal.before.kind !== 'session' || proposal.after.kind !== 'session') return null;
  const before = proposal.before.rows;
  const after = proposal.after.rows;
  const beforeMap = new Map(before.map(r => [r.exerciseId, r]));
  const afterMap = new Map(after.map(r => [r.exerciseId, r]));

  const lines: { mark: DiffMark; text: string }[] = [];

  for (const r of before) {
    if (!afterMap.has(r.exerciseId)) {
      lines.push({ mark: 'remove', text: `${r.exerciseName} (${formatSetSummary(r.sets)})` });
    }
  }
  for (const r of after) {
    const prev = beforeMap.get(r.exerciseId);
    if (!prev) {
      lines.push({ mark: 'add', text: `${r.exerciseName} (${formatSetSummary(r.sets)})` });
      continue;
    }
    const setsChanged = JSON.stringify(prev.sets) !== JSON.stringify(r.sets);
    if (setsChanged) {
      lines.push({ mark: 'change', text: `${r.exerciseName}: ${formatSetSummary(prev.sets)} → ${formatSetSummary(r.sets)}` });
    }
  }

  if (lines.length === 0) {
    return <div className="text-xs text-muted-foreground">No visible change.</div>;
  }

  return (
    <div className="space-y-1">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Active session</div>
      {lines.map((line, i) => (
        <div key={i} className={cn('text-xs py-0.5', markClass[line.mark])}>
          {line.mark === 'add' ? '+ ' : line.mark === 'remove' ? '− ' : '~ '}{line.text}
        </div>
      ))}
    </div>
  );
};

export const ProposalDiffCard: React.FC<Props> = ({ proposal, templateNameById, onApply, onDiscard }) => {
  if (proposal.status === 'invalid') {
    return (
      <div className="mt-2 pt-2 border-t border-border">
        <div className="rounded-lg bg-destructive/10 border border-destructive/40 px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5 text-destructive text-xs font-medium">
            <AlertTriangle className="w-3.5 h-3.5" />
            Proposal rejected
          </div>
          <p className="text-xs text-foreground/80">{proposal.error}</p>
          {proposal.suggestions && proposal.suggestions.length > 0 && (
            <p className="text-[11px] text-muted-foreground">Suggestions: {proposal.suggestions.join(', ')}</p>
          )}
        </div>
      </div>
    );
  }

  const body =
    proposal.before.kind === 'template' ? <TemplateDiff before={proposal.before} after={proposal.after} /> :
    proposal.before.kind === 'program' ? <ProgramDiff before={proposal.before} after={proposal.after} templateNameById={templateNameById} /> :
    proposal.before.kind === 'active-program' ? <ActiveProgramDiff before={proposal.before} after={proposal.after} /> :
    proposal.before.kind === 'session' ? <SessionDiff proposal={proposal} /> :
    null;

  return (
    <div className="mt-2 pt-2 border-t border-border">
      <div className="rounded-lg bg-background/40 border border-border px-3 py-2 space-y-2">
        <div className="text-xs font-medium text-foreground">{proposal.summary}</div>
        {body}
        {proposal.status === 'pending' && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => onApply(proposal.id)}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg gradient-green text-primary-foreground font-medium"
            >
              <Check className="w-3 h-3" />
              Apply
            </button>
            <button
              onClick={() => onDiscard(proposal.id)}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-secondary text-secondary-foreground font-medium"
            >
              <X className="w-3 h-3" />
              Discard
            </button>
          </div>
        )}
        {proposal.status === 'applied' && (
          <div className="flex items-center gap-1 text-xs text-primary font-medium">
            <Check className="w-3.5 h-3.5" />
            Applied
          </div>
        )}
        {proposal.status === 'discarded' && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <X className="w-3.5 h-3.5" />
            Discarded
          </div>
        )}
      </div>
    </div>
  );
};
