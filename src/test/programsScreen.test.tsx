import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgramsScreen } from '@/components/ProgramsScreen';
import type { WorkoutProgram, WorkoutTemplate } from '@/types/workout';

function makeTemplate(id: string, name: string): WorkoutTemplate {
  return { id, name, exercises: [] };
}

function makeProgram(overrides: Partial<WorkoutProgram> = {}): WorkoutProgram {
  return {
    id: 'prog-1',
    name: 'PPL 3-Day',
    days: [
      { label: 'Day 1', templateId: 'tpl-push' },
      { label: 'Day 2', templateId: 'tpl-pull' },
      { label: 'Day 3', templateId: 'tpl-legs' },
    ],
    ...overrides,
  };
}

const noopProps = {
  activeProgramId: null,
  onSetActive: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onCreate: vi.fn(),
  onBack: vi.fn(),
};

describe('ProgramsScreen day labels', () => {
  it('renders "Day N: <template name>" for a 3-day program', () => {
    const templates = [
      makeTemplate('tpl-push', 'Push'),
      makeTemplate('tpl-pull', 'Pull'),
      makeTemplate('tpl-legs', 'Legs'),
    ];
    render(
      <ProgramsScreen
        programs={[makeProgram()]}
        templates={templates}
        {...noopProps}
      />,
    );

    expect(screen.getByText('Day 1: Push')).toBeInTheDocument();
    expect(screen.getByText('Day 2: Pull')).toBeInTheDocument();
    expect(screen.getByText('Day 3: Legs')).toBeInTheDocument();
  });

  it('does not render duplicated "Name: Name" when day label equals template name', () => {
    const templates = [
      makeTemplate('tpl-fba', 'Full Body A'),
      makeTemplate('tpl-fbb', 'Full Body B'),
    ];
    const program = makeProgram({
      days: [
        { label: 'Full Body A', templateId: 'tpl-fba' },
        { label: 'Full Body B', templateId: 'tpl-fbb' },
      ],
    });

    render(
      <ProgramsScreen
        programs={[program]}
        templates={templates}
        {...noopProps}
      />,
    );

    expect(screen.queryByText('Full Body A: Full Body A')).toBeNull();
    expect(screen.queryByText('Full Body B: Full Body B')).toBeNull();
    expect(screen.getByText('Day 1: Full Body A')).toBeInTheDocument();
    expect(screen.getByText('Day 2: Full Body B')).toBeInTheDocument();
  });

  it('renders "Day N: Rest" for rest days', () => {
    const templates = [makeTemplate('tpl-push', 'Push')];
    const program = makeProgram({
      days: [
        { label: 'Day 1', templateId: 'tpl-push' },
        { label: 'Rest', templateId: 'rest' },
      ],
    });

    render(
      <ProgramsScreen
        programs={[program]}
        templates={templates}
        {...noopProps}
      />,
    );

    expect(screen.getByText('Day 1: Push')).toBeInTheDocument();
    expect(screen.getByText('Day 2: Rest')).toBeInTheDocument();
  });

  it('renders "?" when template is missing', () => {
    const program = makeProgram({
      days: [{ label: 'Day 1', templateId: 'missing-id' }],
    });

    render(
      <ProgramsScreen
        programs={[program]}
        templates={[]}
        {...noopProps}
      />,
    );

    expect(screen.getByText('Day 1: ?')).toBeInTheDocument();
  });
});
