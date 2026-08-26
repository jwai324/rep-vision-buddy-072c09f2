import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProposalDiffCard } from '@/components/chat/ProposalDiffCard';
import type { Proposal } from '@/contexts/ChatContext';

const CUSTOM_ID = 'custom-95ca6d55-5bd8-4e0a-9f77-2b1c0d3e4f56';

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [{
      id: CUSTOM_ID,
      name: 'Wall Sit Hold',
      primaryBodyPart: 'Legs',
      equipment: 'Bodyweight',
      difficulty: 'Beginner' as const,
      exerciseType: 'Isolation' as const,
      movementPattern: 'Squat',
      secondaryMuscles: [],
      isCustom: true as const,
      isRecovery: false,
      excludeFromVolume: false,
    }],
    loading: false,
    addExercise: vi.fn(),
    deleteExercise: vi.fn(),
    updateExercise: vi.fn(),
  }),
}));

const row = (exerciseId: string) => ({ exerciseId, sets: 3, targetReps: 15, setType: 'normal', restSeconds: 90 });

const appendProposal: Proposal = {
  id: 'p1',
  messageId: 'm1',
  toolName: 'add_exercises_to_template',
  arguments: {},
  before: { kind: 'template', template: { id: 't1', name: "Wednesday Iso's", exercises: [row('flat-barbell-bench-press')] } },
  after: { kind: 'template', template: { id: 't1', name: "Wednesday Iso's", exercises: [row('flat-barbell-bench-press'), row(CUSTOM_ID)] } },
  status: 'pending',
  summary: 'Add 1 exercise to "Wednesday Iso\'s"',
};

describe('ProposalDiffCard exercise names', () => {
  it('names an appended custom exercise instead of showing its raw id', () => {
    render(<ProposalDiffCard proposal={appendProposal} templateNameById={{}} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/Wall Sit Hold · 3×15/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(CUSTOM_ID))).toBeNull();
  });

  it('still names built-in exercises', () => {
    render(<ProposalDiffCard proposal={appendProposal} templateNameById={{}} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(/Flat Barbell Bench Press/)).toBeInTheDocument();
  });
});
