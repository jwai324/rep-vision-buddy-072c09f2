import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgramBuilder } from '@/components/ProgramBuilder';
import { programOccurrences } from '@/utils/programFrequency';
import { formatLocalDate } from '@/utils/dateUtils';
import type { WorkoutTemplate } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/CustomExercisesContext', () => {
  const exercises: never[] = [];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});

const pull: WorkoutTemplate = {
  id: 'tpl-pull',
  name: 'Pull Day',
  exercises: [{ exerciseId: 'barbell-bent-over-row', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }],
};

/** The calendar's button for a day of the shown month (outside days repeat the number). */
const dayCell = (date: Date) => Array.from(document.querySelectorAll<HTMLButtonElement>('button[name="day"]'))
  .find(el => el.textContent === String(date.getDate()) && !el.classList.contains('day-outside')) as HTMLElement;

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('the program editor calendar preview', () => {
  it("marks today for a new program's every-N-days workout, as the saved schedule will", () => {
    render(
      <ProgramBuilder templates={[pull]} history={[]} onSave={vi.fn()} onSaveTemplate={vi.fn().mockResolvedValue(true)} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('Workout for day 1'), { target: { value: 'tpl-pull' } });
    fireEvent.change(screen.getByLabelText('Frequency for day 1'), { target: { value: 'everyNDays' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show Calendar Preview' }));

    const today = new Date();
    const scheduled = programOccurrences({
      durationWeeks: 8,
      startDate: formatLocalDate(),
      days: [{ label: 'Day 1', templateId: 'tpl-pull', frequency: { type: 'everyNDays', interval: 2, startDate: formatLocalDate() } }],
    });
    expect(scheduled[0].date.getDate()).toBe(today.getDate());
    // The preview's own loop compared today's midnight against a start
    // carrying the time of day and dropped it.
    expect(dayCell(today)).toHaveClass('!bg-primary/20');
  });
});
