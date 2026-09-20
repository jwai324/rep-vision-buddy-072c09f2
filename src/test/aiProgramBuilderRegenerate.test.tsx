import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({ refreshBalance: vi.fn() }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { AIProgramBuilder } from '@/components/AIProgramBuilder';

const REVIEW_DRAFT = {
  version: 1,
  phase: 'review',
  currentStep: 9,
  inputs: {
    goal: 'Hypertrophy', experience: 'Intermediate (1-3 years)', daysPerWeek: 2,
    sessionDuration: '60 min', programDuration: '4 weeks',
    equipment: ['Barbell', 'Dumbbell'], injuries: '', splitPreference: 'Upper/Lower',
    additionalNotes: '',
  },
  messages: [{ role: 'ai', content: "What's your primary training goal?", step: 'goal' }],
  selectedEquipment: ['Barbell', 'Dumbbell'],
  generatedProgram: {
    program_name: 'Reviewed Plan',
    goal: 'Hypertrophy',
    days_per_week: 2,
    weeks: 4,
    training_days: [
      {
        day_number: 1, day_name: 'Upper A', focus: 'Chest',
        exercises: [{
          exercise_name: 'Flat Barbell Bench Press', sets: 3, reps: '8-10',
          rest_seconds: 120, set_type: 'normal', order: 1, superset_group: null,
        }],
      },
    ],
  },
  saveIds: null,
};

const renderReview = () => {
  localStorage.setItem('ai_program_builder_draft', JSON.stringify(REVIEW_DRAFT));
  return render(<AIProgramBuilder onBack={vi.fn()} onSaveProgram={vi.fn()} />);
};

const swapBenchForDumbbellPress = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Swap Flat Barbell Bench Press' }));
  fireEvent.click(screen.getByRole('button', { name: /Flat Dumbbell Press/ }));
};

describe('regenerating a reviewed AI program', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue({
      data: {
        program: {
          program_name: 'Fresh Plan', goal: 'Hypertrophy', days_per_week: 2, weeks: 4,
          training_days: [{
            day_number: 1, day_name: 'Upper A', focus: 'Chest',
            exercises: [{
              exercise_name: 'Incline Dumbbell Press', sets: 3, reps: '8-10',
              rest_seconds: 120, set_type: 'normal', order: 1, superset_group: null,
            }],
          }],
        },
      },
      error: null,
    });
  });

  it('asks first, naming the credit cost, and generates nothing until confirmed', () => {
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate program' }));

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/spends AI credits/i);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/replaces the program below/i);
  });

  it('warns about lost swaps only once the user has made one', () => {
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate program' }));
    expect(screen.getByRole('alertdialog')).not.toHaveTextContent(/exercise swaps/i);
    fireEvent.click(screen.getByRole('button', { name: 'Keep this program' }));

    swapBenchForDumbbellPress();
    fireEvent.click(screen.getByRole('button', { name: 'Regenerate program' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/exercise swaps you made/i);
  });

  it('leaves the reviewed plan and its swaps untouched when the user backs out', () => {
    renderReview();
    swapBenchForDumbbellPress();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate program' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this program' }));

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(screen.getByText('Reviewed Plan')).toBeInTheDocument();
    expect(screen.getByText('Flat Dumbbell Press')).toBeInTheDocument();
    expect(screen.queryByText('Flat Barbell Bench Press')).not.toBeInTheDocument();
  });

  it('runs the generation once confirmed', async () => {
    renderReview();

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate program' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate new' }));
    });

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][0]).toBe('generate-program');
    expect(await screen.findByText('Fresh Plan')).toBeInTheDocument();
  });
});
