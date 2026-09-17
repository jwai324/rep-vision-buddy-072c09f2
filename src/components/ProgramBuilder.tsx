import React, { useState, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { format, addDays, addWeeks, getDay } from 'date-fns';
import { ArrowLeft, CalendarIcon, ChevronDown, ChevronRight } from 'lucide-react';
import { parseLocalDate } from '@/utils/dateUtils';
import type { WorkoutProgram, WorkoutTemplate, WorkoutSession, DayFrequency, ProgramDay } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useExerciseLookup } from '@/hooks/useExerciseLookup';
import { useCustomExercisesContext } from '@/contexts/CustomExercisesContext';
import { blocksToExercises, templateToBlocks, type TemplateBlock } from '@/utils/templateBlocks';
import { TemplateExerciseEditor, type BlocksUpdate } from '@/components/TemplateExerciseEditor';

interface ProgramBuilderProps {
  templates: WorkoutTemplate[];
  history: WorkoutSession[];
  initial?: WorkoutProgram;
  weightUnit?: WeightUnit;
  defaultRestSeconds?: number;
  onSave: (program: WorkoutProgram) => Promise<boolean>;
  /** Resolves once the template row is written, or queued for retry — see `useStorage.saveTemplate`. */
  onSaveTemplate: (template: WorkoutTemplate) => Promise<boolean>;
  onCancel: () => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FREQUENCY_OPTIONS = [
  { value: 'none', label: 'No schedule' },
  { value: 'weekly', label: 'Weekly on…' },
  { value: 'everyNDays', label: 'Every N days' },
  { value: 'monthly', label: 'Monthly on day…' },
];

const DRAFT_KEY = 'program_builder_draft';

/** Unsaved edits to the templates the program's days point at, keyed by template id. */
type TemplateDrafts = Record<string, TemplateBlock[]>;

interface ProgramDraft {
  name: string;
  durationWeeks: number;
  days: ProgramDay[];
  templateDrafts: TemplateDrafts;
}

function loadDraft(initial?: WorkoutProgram): ProgramDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw);
      if ((draft.id ?? null) === (initial?.id ?? null)) {
        return {
          name: draft.name ?? '',
          durationWeeks: draft.durationWeeks ?? 8,
          days: draft.days ?? [{ label: 'Day 1', templateId: 'rest' }],
          templateDrafts: draft.templateDrafts ?? {},
        };
      }
    }
  } catch { /* ignore */ }
  return {
    name: initial?.name ?? '',
    durationWeeks: initial?.durationWeeks ?? 8,
    days: initial?.days ?? [{ label: 'Day 1', templateId: 'rest' }],
    templateDrafts: {},
  };
}

/**
 * The program editor, laid out like the program view: one tile per day, each
 * holding that day's fields, with a footer that opens the day's template for
 * editing in place. Template edits are drafts held here per template id — so
 * two days on the same template show one set of changes — and each tile saves
 * its own template through `onSaveTemplate`, independently of the program.
 * Templates are shared by id, so a save here reaches every program that uses
 * the template; the expanded tile says so.
 */
export const ProgramBuilder: React.FC<ProgramBuilderProps> = ({
  templates, history, initial, weightUnit = 'kg', defaultRestSeconds = 90, onSave, onSaveTemplate, onCancel,
}) => {
  const exerciseLookup = useExerciseLookup();
  const { exercises: customExercises } = useCustomExercisesContext();
  const [draft] = useState(() => loadDraft(initial));
  const [name, setName] = useState(draft.name);
  const [durationWeeks, setDurationWeeks] = useState(draft.durationWeeks);
  const [startDate] = useState(() => initial?.startDate ? new Date(initial.startDate + 'T00:00:00') : new Date());
  const [days, setDays] = useState<ProgramDay[]>(draft.days);
  const [templateDrafts, setTemplateDrafts] = useState<TemplateDrafts>(draft.templateDrafts);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);
  const [showCalendar, setShowCalendar] = useState(false);

  // Cache draft to localStorage on every change
  React.useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: initial?.id ?? null, name, durationWeeks, days, templateDrafts }));
    } catch { /* ignore */ }
  }, [name, durationWeeks, days, templateDrafts, initial?.id]);

  const clearDraft = React.useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  const templatesById = useMemo(
    () => Object.fromEntries(templates.map(t => [t.id, t])) as Record<string, WorkoutTemplate>,
    [templates],
  );

  // What a tile shows until the user touches the template. Recomputed when the
  // custom library lands so names and band levels resolve, as the template
  // builder's own load does.
  const liveBlocks = useMemo(
    () => new Map(templates.map(t => [t.id, templateToBlocks(t, weightUnit, customExercises)])),
    [templates, weightUnit, customExercises],
  );

  const addDay = () => {
    setDays(prev => [...prev, { label: `Day ${prev.length + 1}`, templateId: 'rest' }]);
  };

  const updateDay = useCallback((index: number, field: Partial<ProgramDay>) => {
    setDays(prev => prev.map((d, i) => i === index ? { ...d, ...field } : d));
  }, []);

  const removeDay = useCallback((index: number) => {
    setDays(prev => prev.filter((_, i) => i !== index));
    // Tiles are keyed by position, so the ones below the removed day move up.
    setExpanded(prev => new Set([...prev].filter(i => i !== index).map(i => (i > index ? i - 1 : i))));
  }, []);

  const toggleExpanded = useCallback((index: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const changeTemplateBlocks = useCallback((templateId: string, update: BlocksUpdate) => {
    setTemplateDrafts(prev => ({ ...prev, [templateId]: update(prev[templateId] ?? liveBlocks.get(templateId) ?? []) }));
  }, [liveBlocks]);

  const discardTemplateDraft = useCallback((templateId: string) => {
    setTemplateDrafts(prev => {
      const { [templateId]: _dropped, ...rest } = prev;
      return rest;
    });
  }, []);

  const saveTemplateDraft = useCallback(async (templateId: string) => {
    const live = templatesById[templateId];
    const blocks = templateDrafts[templateId];
    if (!live || !blocks) return;
    if (blocks.length === 0) {
      toast.error('Add at least one exercise.');
      return;
    }
    setSavingTemplateId(templateId);
    const ok = await onSaveTemplate({
      id: live.id,
      name: live.name,
      exercises: blocksToExercises(blocks, weightUnit, customExercises),
    });
    setSavingTemplateId(null);
    // A failed write is still applied locally and queued for retry, so the
    // draft has done its job either way. Edits typed while the save was in
    // flight are a newer draft and stay unsaved.
    setTemplateDrafts(prev => {
      if (prev[templateId] !== blocks) return prev;
      const { [templateId]: _saved, ...rest } = prev;
      return rest;
    });
    if (ok) toast.success(`Template "${live.name}" saved.`);
  }, [templatesById, templateDrafts, onSaveTemplate, weightUnit, customExercises]);

  // Templates a day points at that carry edits not yet saved from their tile.
  const unsavedTemplateNames = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const day of days) {
      const t = templatesById[day.templateId];
      if (!t || !templateDrafts[t.id] || seen.has(t.id)) continue;
      seen.add(t.id);
      names.push(t.name);
    }
    return names;
  }, [days, templatesById, templateDrafts]);

  // Build calendar events from days + frequency + duration
  const calendarEvents = useMemo(() => {
    const events: { date: Date; label: string; templateId: string }[] = [];
    const endDate = addWeeks(startDate, durationWeeks);

    days.forEach((day) => {
      if (!day.frequency) return;
      const freq = day.frequency;

      if (freq.type === 'weekly') {
        // Find the first occurrence of this weekday on or after startDate
        let current = startDate;
        const targetDay = freq.weekday;
        const currentDay = getDay(current);
        const diff = (targetDay - currentDay + 7) % 7;
        current = addDays(current, diff);

        while (current < endDate) {
          events.push({ date: new Date(current), label: day.label, templateId: day.templateId });
          current = addDays(current, 7);
        }
      } else if (freq.type === 'everyNDays') {
        const origin = freq.startDate ? parseLocalDate(freq.startDate) : new Date(startDate);
        let current = new Date(origin);
        while (current < endDate) {
          if (current >= startDate) {
            events.push({ date: new Date(current), label: day.label, templateId: day.templateId });
          }
          current = addDays(current, freq.interval);
        }
      } else if (freq.type === 'monthly') {
        let current = new Date(startDate);
        current.setDate(freq.dayOfMonth);
        if (current < startDate) {
          current.setMonth(current.getMonth() + 1);
        }
        while (current < endDate) {
          events.push({ date: new Date(current), label: day.label, templateId: day.templateId });
          const next = new Date(current);
          next.setMonth(next.getMonth() + 1);
          current = next;
        }
      }
    });

    return events;
  }, [days, durationWeeks, startDate]);

  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (saving) return;
    if (!name.trim()) {
      toast.error('Enter a program name.');
      return;
    }
    if (days.length === 0) {
      toast.error('Add at least one day.');
      return;
    }
    if (unsavedTemplateNames.length > 0) {
      toast.error(`Save or discard your changes to ${unsavedTemplateNames.join(', ')} first.`);
      return;
    }
    // The draft outlives a failed save on purpose: it is the only copy of the
    // program until the row is written, and the screen stays put on failure so
    // the user can retry. useStorage has already shown the error toast.
    setSaving(true);
    try {
      const saved = await onSave({
        id: initial?.id ?? crypto.randomUUID(),
        name: name.trim(),
        days,
        durationWeeks,
        startDate: format(startDate, 'yyyy-MM-dd'),
      });
      if (!saved) return;
      clearDraft();
      toast.success(`Program "${name.trim()}" saved.`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    clearDraft();
    onCancel();
  };

  const trainingDays = days.filter(d => d.templateId !== 'rest').length;
  const restDays = days.length - trainingDays;

  return (
    <div className="min-h-screen bg-background p-4 pb-24 flex flex-col gap-4 overflow-x-hidden min-w-0 max-w-full">
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleCancel}
          aria-label="Back to programs"
          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground truncate min-w-0">{initial ? 'Edit Program' : 'New Program'}</h1>
      </div>

      <div className="flex flex-col gap-1">
        <input
          type="text"
          placeholder="Program name (e.g., 3-Day Full Body)"
          aria-label="Program name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="bg-secondary rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary font-medium w-full min-w-0"
        />
        <p className="text-xs text-muted-foreground px-1">
          {days.length} days — {trainingDays} training, {restDays} rest · {durationWeeks} weeks
        </p>
      </div>

      {/* Duration */}
      <div className="bg-card rounded-xl p-4 border border-border flex items-center gap-3 min-w-0">
        <label htmlFor="program-duration" className="text-sm font-semibold text-foreground whitespace-nowrap">Duration</label>
        <select
          id="program-duration"
          value={durationWeeks}
          onChange={e => setDurationWeeks(Number(e.target.value))}
          className="bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none flex-1 w-full min-w-0"
        >
          {Array.from({ length: 48 }, (_, i) => i + 1).map(w => (
            <option key={w} value={w}>{w} week{w > 1 ? 's' : ''}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        {days.map((day, i) => {
          const template = templatesById[day.templateId];
          return (
            <ProgramDayTile
              key={i}
              index={i}
              day={day}
              templates={templates}
              history={history}
              exerciseLookup={exerciseLookup}
              template={template}
              blocks={template ? (templateDrafts[template.id] ?? liveBlocks.get(template.id) ?? []) : []}
              dirty={!!template && templateDrafts[template.id] !== undefined}
              saving={!!template && savingTemplateId === template.id}
              open={expanded.has(i)}
              weightUnit={weightUnit}
              defaultRestSeconds={defaultRestSeconds}
              onUpdate={updateDay}
              onRemove={removeDay}
              onToggle={toggleExpanded}
              onChangeBlocks={changeTemplateBlocks}
              onSaveTemplate={saveTemplateDraft}
              onDiscardTemplate={discardTemplateDraft}
            />
          );
        })}
      </div>

      <Button variant="outline" onClick={addDay}>+ Add Day</Button>

      {/* Calendar preview toggle */}
      <Button
        variant="outline"
        onClick={() => setShowCalendar(prev => !prev)}
        className="w-full"
      >
        {showCalendar ? 'Hide' : 'Show'} Calendar Preview
      </Button>

      {showCalendar && (
        <div className="bg-card rounded-xl border border-border min-w-0 overflow-hidden">
          <Calendar
            mode="multiple"
            selected={[]}
            className={cn('p-3 pointer-events-auto w-full [&_.day-selected]:bg-transparent')}
            modifiers={{
              workout: calendarEvents.filter(e => e.templateId !== 'rest').map(e => e.date),
              rest: calendarEvents.filter(e => e.templateId === 'rest').map(e => e.date),
            }}
            modifiersClassNames={{
              workout: '!bg-primary/20 !text-primary font-bold',
              rest: '!bg-blue-500/20 font-bold',
            }}
            numberOfMonths={1}
            defaultMonth={startDate}
          />
          {/* Legend */}
          <div className="flex gap-4 mt-2 px-3 pb-3">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-primary/20 border border-primary/40" />
              <span className="text-[10px] text-muted-foreground">Workout</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-blue-500/20 border border-blue-500/40" />
              <span className="text-[10px] text-muted-foreground">Rest</span>
            </div>
          </div>
        </div>
      )}

      <Button variant="neon" onClick={save} disabled={saving || !name.trim()} className="w-full">Save Program</Button>
    </div>
  );
};

interface ProgramDayTileProps {
  index: number;
  day: ProgramDay;
  templates: WorkoutTemplate[];
  history: WorkoutSession[];
  exerciseLookup: Record<string, string>;
  /** The day's template, when it points at one that still exists. */
  template: WorkoutTemplate | undefined;
  /** The template's draft if it has one, otherwise its saved exercises. */
  blocks: TemplateBlock[];
  dirty: boolean;
  saving: boolean;
  open: boolean;
  weightUnit: WeightUnit;
  defaultRestSeconds: number;
  onUpdate: (index: number, field: Partial<ProgramDay>) => void;
  onRemove: (index: number) => void;
  onToggle: (index: number) => void;
  onChangeBlocks: (templateId: string, update: BlocksUpdate) => void;
  onSaveTemplate: (templateId: string) => void;
  onDiscardTemplate: (templateId: string) => void;
}

const ProgramDayTile: React.FC<ProgramDayTileProps> = ({
  index, day, templates, history, exerciseLookup, template, blocks, dirty, saving, open,
  weightUnit, defaultRestSeconds, onUpdate, onRemove, onToggle, onChangeBlocks, onSaveTemplate, onDiscardTemplate,
}) => {
  const dayNumber = index + 1;
  const templateId = template?.id;
  const onBlocksChange = useCallback((update: BlocksUpdate) => {
    if (templateId) onChangeBlocks(templateId, update);
  }, [templateId, onChangeBlocks]);

  const updateFrequency = (freqType: string) => {
    let frequency: DayFrequency | undefined;
    if (freqType === 'weekly') frequency = { type: 'weekly', weekday: 1 };
    else if (freqType === 'everyNDays') frequency = { type: 'everyNDays', interval: 2, startDate: format(new Date(), 'yyyy-MM-dd') };
    else if (freqType === 'monthly') frequency = { type: 'monthly', dayOfMonth: 1 };
    onUpdate(index, { frequency });
  };

  const updateFrequencyDetail = (freq: DayFrequency) => {
    onUpdate(index, { frequency: freq });
  };

  return (
    <div data-testid="program-day" className="bg-card rounded-xl border border-border min-w-0 overflow-hidden">
      <div className="p-4 flex flex-col gap-2 min-w-0">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <h3 className="font-semibold text-foreground">Day {dayNumber}</h3>
          <button onClick={() => onRemove(index)} aria-label={`Remove day ${dayNumber}`} className="text-set-failure text-xs shrink-0">✕</button>
        </div>

        <input
          type="text"
          aria-label={`Label for day ${dayNumber}`}
          placeholder="Day label"
          value={day.label}
          onChange={e => onUpdate(index, { label: e.target.value })}
          className="bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none w-full min-w-0"
        />

        {/* Workout selection */}
        <select
          aria-label={`Workout for day ${dayNumber}`}
          value={day.templateId}
          onChange={e => onUpdate(index, { templateId: e.target.value })}
          className="bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none w-full min-w-0"
        >
          <option value="rest">🛏️ Rest Day</option>
          <optgroup label="Templates">
            {templates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </optgroup>
          {history.length > 0 && (
            <optgroup label="Past Workouts">
              {history.map(s => (
                <option key={s.id} value={`session:${s.id}`}>
                  {parseLocalDate(s.date).toLocaleDateString()} — {s.exercises.map(e => exerciseLookup[e.exerciseId] ?? e.exerciseName).join(', ')}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        {/* Frequency selection */}
        <select
          aria-label={`Frequency for day ${dayNumber}`}
          value={day.frequency?.type ?? 'none'}
          onChange={e => updateFrequency(e.target.value)}
          className="bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none w-full min-w-0"
        >
          {FREQUENCY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        {/* Frequency detail */}
        {day.frequency?.type === 'weekly' && (
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((label, idx) => {
              const selected = day.frequency?.type === 'weekly' && day.frequency.weekday === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateFrequencyDetail({ type: 'weekly', weekday: idx })}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    selected ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {day.frequency?.type === 'everyNDays' && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Every</span>
              <select
                aria-label={`Interval for day ${dayNumber}`}
                value={day.frequency.interval}
                onChange={e => updateFrequencyDetail({ type: 'everyNDays', interval: Number(e.target.value), startDate: day.frequency?.type === 'everyNDays' ? day.frequency.startDate : undefined })}
                className="bg-secondary rounded-md px-2 py-1 text-xs text-foreground outline-none"
              >
                {[2, 3, 4, 5, 6, 7].map(n => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">days</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Starting from</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
                    <CalendarIcon className="h-3 w-3" />
                    {day.frequency.startDate
                      ? format(parseLocalDate(day.frequency.startDate), 'MMM d, yyyy')
                      : 'Today'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={day.frequency.startDate ? parseLocalDate(day.frequency.startDate) : new Date()}
                    onSelect={(d) => {
                      if (d) updateFrequencyDetail({ type: 'everyNDays', interval: day.frequency?.type === 'everyNDays' ? day.frequency.interval : 2, startDate: format(d, 'yyyy-MM-dd') });
                    }}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        )}

        {day.frequency?.type === 'monthly' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Day</span>
            <select
              aria-label={`Day of month for day ${dayNumber}`}
              value={day.frequency.dayOfMonth}
              onChange={e => updateFrequencyDetail({ type: 'monthly', dayOfMonth: Number(e.target.value) })}
              className="bg-secondary rounded-md px-2 py-1 text-xs text-foreground outline-none"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground">of each month</span>
          </div>
        )}
      </div>

      {/* Rest days and past workouts have no template to open. */}
      {template && (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => onToggle(index)}
            className="w-full px-4 py-2.5 border-t border-border bg-secondary/30 flex items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-muted-foreground truncate">
                {template.name} · {blocks.length} exercise{blocks.length === 1 ? '' : 's'}
              </span>
              {dirty && (
                <span className="text-[10px] font-bold text-primary uppercase shrink-0">Unsaved changes</span>
              )}
            </span>
            {open
              ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
              : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />}
          </button>

          {open && (
            <div className="px-4 pb-4 pt-3 border-t border-border flex flex-col gap-3">
              <p className="text-xs text-muted-foreground">Changes apply everywhere this template is used.</p>
              <TemplateExerciseEditor
                blocks={blocks}
                onChange={onBlocksChange}
                weightUnit={weightUnit}
                defaultRestSeconds={defaultRestSeconds}
                idPrefix={`program-day-${dayNumber}`}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" disabled={!dirty || saving} onClick={() => onDiscardTemplate(template.id)}>
                  Discard
                </Button>
                <Button variant="neon" size="sm" disabled={!dirty || saving} onClick={() => onSaveTemplate(template.id)}>
                  {saving ? 'Saving…' : 'Save template'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
