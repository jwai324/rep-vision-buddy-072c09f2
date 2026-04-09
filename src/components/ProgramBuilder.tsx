import React, { useState } from 'react';
import type { WorkoutProgram, WorkoutTemplate, WorkoutSession, ProgramSchedule } from '@/types/workout';
import { Button } from '@/components/ui/button';

interface ProgramBuilderProps {
  templates: WorkoutTemplate[];
  history: WorkoutSession[];
  initial?: WorkoutProgram;
  onSave: (program: WorkoutProgram) => void;
  onCancel: () => void;
}

export const ProgramBuilder: React.FC<ProgramBuilderProps> = ({ templates, history, initial, onSave, onCancel }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [days, setDays] = useState(initial?.days ?? [{ label: 'Day 1', templateId: 'rest' as string }]);
  const [scheduleType, setScheduleType] = useState<string>(initial?.schedule?.type ?? 'none');
  const [weekdays, setWeekdays] = useState<number[]>(
    initial?.schedule?.type === 'weekly' ? initial.schedule.weekdays : [1]
  );
  const [dayOfMonth, setDayOfMonth] = useState<number>(
    initial?.schedule?.type === 'monthly' ? initial.schedule.dayOfMonth : 1
  );
  const [interval, setInterval] = useState<number>(
    initial?.schedule?.type === 'everyNDays' ? initial.schedule.interval : 2
  );

  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const toggleWeekday = (day: number) => {
    setWeekdays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort()
    );
  };

  const buildSchedule = (): ProgramSchedule | undefined => {
    if (scheduleType === 'weekly') return { type: 'weekly', weekdays };
    if (scheduleType === 'monthly') return { type: 'monthly', dayOfMonth };
    if (scheduleType === 'everyNDays') return { type: 'everyNDays', interval };
    return undefined;
  };

  const addDay = () => {
    setDays(prev => [...prev, { label: `Day ${prev.length + 1}`, templateId: 'rest' }]);
  };

  const updateDay = (index: number, templateId: string) => {
    setDays(prev => prev.map((d, i) => i === index ? { ...d, templateId } : d));
  };

  const updateLabel = (index: number, label: string) => {
    setDays(prev => prev.map((d, i) => i === index ? { ...d, label } : d));
  };

  const removeDay = (index: number) => {
    setDays(prev => prev.filter((_, i) => i !== index));
  };

  const save = () => {
    if (!name.trim() || days.length === 0) return;
    onSave({ id: initial?.id ?? crypto.randomUUID(), name: name.trim(), days, schedule: buildSchedule() });
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-foreground">{initial ? 'Edit' : 'New'} Program</h2>
        <button onClick={onCancel} className="text-sm text-muted-foreground hover:text-foreground">Cancel</button>
      </div>

      <input
        type="text"
        placeholder="Program name (e.g., 3-Day Full Body)"
        value={name}
        onChange={e => setName(e.target.value)}
        className="bg-secondary rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary font-medium"
      />

      {days.map((day, i) => (
        <div key={i} className="bg-card rounded-xl p-4 border border-border flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={day.label}
              onChange={e => updateLabel(i, e.target.value)}
              className="bg-secondary rounded-md px-2 py-1 text-sm text-foreground outline-none flex-1"
            />
            <button onClick={() => removeDay(i)} className="text-set-failure text-xs">✕</button>
          </div>
          <select
            value={day.templateId}
            onChange={e => updateDay(i, e.target.value)}
            className="bg-secondary rounded-md px-2 py-1.5 text-sm text-foreground outline-none"
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
                    {new Date(s.date).toLocaleDateString()} — {s.exercises.map(e => e.exerciseName).join(', ')}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      ))}

      <Button variant="outline" onClick={addDay}>+ Add Day</Button>
      <Button variant="neon" onClick={save} disabled={!name.trim()} className="w-full">Save Program</Button>
    </div>
  );
};
