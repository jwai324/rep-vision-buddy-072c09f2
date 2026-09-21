import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProposalDiffCard } from '@/components/chat/ProposalDiffCard';
import type { ExerciseInput, Proposal } from '@/contexts/ChatContext';

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({ exercises: [] }),
}));

const BENCH = 'flat-barbell-bench-press';

const row = (over: Partial<ExerciseInput> = {}): ExerciseInput =>
  ({ exerciseId: BENCH, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90, ...over });

const edit = (before: ExerciseInput, after: ExerciseInput): Proposal => ({
  id: 'p1',
  messageId: 'm1',
  toolName: 'edit_template',
  arguments: {},
  before: { kind: 'template', template: { id: 't1', name: 'Push', exercises: [before] } },
  after: { kind: 'template', template: { id: 't1', name: 'Push', exercises: [after] } },
  status: 'pending',
  summary: 'Edit "Push"',
});

const benchRow = () => screen.getByText(/Flat Barbell Bench Press/);

describe('ProposalDiffCard edit rows', () => {
  it.each([
    ['target weight', row({ targetWeight: 60 }), row({ targetWeight: 70 })],
    ['target RPE', row({ targetRpe: 7 }), row({ targetRpe: 8 })],
    ['set type', row(), row({ setType: 'dropset' })],
    ['superset link', row(), row({ supersetGroup: 1 })],
  ])('mark a row whose %s is all that changed', (_field, before, after) => {
    render(<ProposalDiffCard proposal={edit(before, after)} templateNameById={{}} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(benchRow().textContent).toMatch(/^~ /);
  });

  it('leave a row alone when only the absent fields differ in spelling', () => {
    const before = { ...row({ targetWeight: undefined }), setType: undefined, supersetGroup: undefined };
    render(<ProposalDiffCard proposal={edit(before, row())} templateNameById={{}} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(benchRow().textContent).not.toMatch(/^~ /);
  });

  it('show the RPE and a non-normal set type on the row', () => {
    render(<ProposalDiffCard proposal={edit(row(), row({ targetRpe: 8, setType: 'dropset' }))} templateNameById={{}} onApply={vi.fn()} onDiscard={vi.fn()} />);
    expect(benchRow().textContent).toBe('~ Flat Barbell Bench Press · 3×10 · rest 90s · RPE 8 · dropset');
  });
});
