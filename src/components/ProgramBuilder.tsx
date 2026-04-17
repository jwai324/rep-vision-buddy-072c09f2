import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { format, addDays, addWeeks, getDay } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import { parseLocalDate } from '@/utils/dateUtils';
import type { WorkoutProgram, WorkoutTemplate, WorkoutSession, DayFrequency, ProgramDay } from '@/types/workout';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface ProgramBuilderProps {
  templates: WorkoutTemplate[];
  history: WorkoutSession[];
  initial?: WorkoutProgram;
  onSave: (program: WorkoutProgram) => void;
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

function loadDraft(initial?: WorkoutProgram): { name: string; durationWeeks: number; days: ProgramDay[] } {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const draft = JSON.parse(raw);
      if ((draft.id ?? null) === (initial?.id ?? null)) {
        return {
          name: draft.name ?? '',
          durationWeeks: draft.durationWeeks ?? 8,
          days: draft.days ?? [{ label: 'Day 1', templateId: 'rest' }],
        };
      }
    }
  } catch { /* ignore */ }
  return {
    name: initial?.name ?? '',
    durationWeeks: initial?.durationWeeks ?? 8,
    days: initial?.days ?? [{ label: 'Day 1', templateId: 'rest' }],
  };
}

export const ProgramBuilder: React.FC<ProgramBuilderProps> = ({ templates, history, initial, onSave, onCancel }) => {
  const draft = React.useMemo(() => loadDraft(initial), []);
  const [name, setName] = useState(draft.name);
  const [durationWeeks, setDurationWeeks] = useState(draft.durationWeeks);
  const [startDate] = useState(() => initial?.startDate ? new Date(initial.startDate + 'T00:00:00') : new Date());
  const [days, setDays] = useState<ProgramDay[]>(draft.days);
  const [showCalendar, setShowCalendar] = useState(false);

  // Cache draft to localStorage on every change
  React.useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: initial?.id ?? null, name, durationWeeks, days }));
    } catch { /* ignore */ }
  }, [name, durationWeeks, days, initial?.id]);

  const clearDraft = React.useCallback(() => {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }, []);

  const addDay = () => {
    setDays(prev => [...prev, { label: `Day ${prev.length + 1}`, templateId: 'rest' }]);
  };

  const updateDay = (index: number, field: Partial<ProgramDay>) => {
    setDays(prev => prev.map((d, i) => i === index ? { ...d, ...field } : d));
  };

  const updateFrequency = (index: number, freqType: string) => {
    let frequency: DayFrequency | undefined;
    if (freqType === 'weekly') frequency = { type: 'weekly', weekday: 1 };
    else if (freqType === 'everyNDays') frequency = { type: 'everyNDays', interval: 2, startDate: format(new Date(), 'yyyy-MM-dd') };
    else if (freqType === 'monthly') frequency = { type: 'monthly', dayOfMonth: 1 };
    updateDay(index, { frequency });
  };

  const updateFrequencyDetail = (index: number, freq: DayFrequency) => {
    updateDay(index, { frequency: freq });
  };

  const removeDay = (index: number) => {
    setDays(prev => prev.filter((_, i) => i !== index));
  };

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

  const eventDates = useMemo(() => {
    const map = new Map<string, { label: string; isRest: boolean }[]>();
    calendarEvents.forEach(e => {
      const key = format(e.date, 'yyyy-MM-dd');
      const arr = map.get(key) ?? [];
      arr.push({ label: e.label, isRest: e.templateId === 'rest' });
      map.set(key, arr);
    });
    return map;
  }, [calendarEvents]);

  const save = () => {
    if (!name.trim()) {
      toast.error('Enter a program name.');
      return;
    }
    if (days.length === 0) {
      toast.error('Add at least one day.');
      return;
    }
    clearDraft();
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      days,
      durationWeeks,
      startDate: format(startDate, 'yyyy-MM-dd'),
    });
    toast.success(`Program "${name.trim()}" saved.`);
  };

  const handleCancel = () => {
    clearDraft();
    onCancel();
  };

  return (
    <div className="p-4 flex flex-col gap-4 pb-24 overflow-x-hidden min-w-0 max-w-full">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <h2 className="text-xl font-bold text-foreground truncate min-w-0">{initial ? 'Edit' : 'New'} Program</h2>
        <button onClick={handleCancel} className="text-sm text-muted-foreground hover:text-foreground shrink-0">Cancel</button>
      </div>

      <input
        type="text"
        placeholder="Program name (e.g., 3-Day Full Body)"
        value={name}
        onChange={e => setName(e.target.value)}
        className="bg-secondary rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary font-medium w-full min-w-0"
      />

      {/* Duration */}
      <div className="bg-card rounded-xl p-4 border border-border flex items-center gap-3 min-w-0">
        <label className="text-sm font-semibold text-foreground whitespace-nowrap">Duration</label>
        <select
          value={durationWeeks}
          onChange={e => setDurationWeeks(Number(e.target.value))}
          className="bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none flex-1 w-full min-w-0"
        >
          {Array.from({ length: 48 }, (_, i) => i + 1).map(w => (
            <option key={w} value={w}>{w} week{w > 1 ? 's' : ''}</option>
          ))}
        </select>
      </div>

      {/* Day entries */}
      {days.map((day, i) => (
        <div key={i} className="bg-card rounded-xl p-4 border border-border flex flex-col gap-2 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <input
              type="text"
              value={day.label}
              onChange={e => updateDay(i, { label: e.target.value })}
              className="bg-secondary rounded-md px-2 py-1 text-sm text-foreground outline-none flex-1 w-full min-w-0"
            />
            <button onClick={() => removeDay(i)} className="text-set-failure text-xs shrink-0">✕</button>
          </div>

          {/* Workout selection */}
          <select
            value={day.templateId}
            onChange={e => updateDay(i, { templateId: e.target.value })}
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
                    {parseLocalDate(s.date).toLocaleDateString()} — {s.exercises.map(e => e.exerciseName).join(', ')}
                  </option>
                ))}
              </optgroup>
            )}
          </select>

          {/* Frequency selection */}
          <select
            value={day.frequency?.type ?? 'none'}
            onChange={e => updateFrequency(i, e.target.value)}
            className="bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none w-full min-w-0"
          >
            {FREQUENCY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Frequency detail */}
          {day.frequency?.type === 'weekly' && (
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => updateFrequencyDetail(i, { type: 'weekly', weekday: idx })}
                  className={cn(
                    'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                    day.frequency?.type === 'weekly' && day.frequency.weekday === idx
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {day.frequency?.type === 'everyNDays' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Every</span>
                <select
                  value={day.frequency.interval}
                  onChange={e => updateFrequencyDetail(i, { type: 'everyNDays', interval: Number(e.target.value), startDate: day.frequency?.type === 'everyNDays' ? day.frequency.startDate : undefined })}
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
                        if (d) updateFrequencyDetail(i, { type: 'everyNDays', interval: day.frequency?.type === 'everyNDays' ? day.frequency.interval : 2, startDate: format(d, 'yyyy-MM-dd') });
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
                value={day.frequency.dayOfMonth}
                onChange={e => updateFrequencyDetail(i, { type: 'monthly', dayOfMonth: Number(e.target.value) })}
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
      ))}

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
          <div className="flex gap-4 mt-2 px-3">
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

      <Button variant="neon" onClick={save} disabled={!name.trim()} className="w-full">Save Program</Button>
    </div>
  );
};
