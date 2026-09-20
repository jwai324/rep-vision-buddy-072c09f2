import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EMPTY_BALANCE } from '@/utils/credits';
import type { ExerciseBlock } from '@/types/activeSession';

// A representative sample of the icon-only controls that carry an aria-label:
// a control whose only content is an icon is announced as "button" without
// one, and voice control has nothing to say to it.

const chatValue = {
  messages: [] as unknown[],
  isOpen: false,
  isLoading: false,
  setOpen: vi.fn(),
  sendMessage: vi.fn(),
  clearChat: vi.fn(),
  quickChips: [] as string[],
  creditsBalance: { ...EMPTY_BALANCE, credits: 1000, estMessagesLeft: 50 },
  godMode: false,
  consecutiveErrors: 0,
  cooldownActive: false,
  lockedUntil: 0,
  proposals: {},
  proposalIdsByMessage: {},
  applyProposal: vi.fn(),
  discardProposal: vi.fn(),
};

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => chatValue,
  GOD_MODE_PHRASE: 'god mode',
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { AIChatBubble } from '@/components/AIChatBubble';
import { ExerciseTable } from '@/components/ExerciseTableComponent';
import { ProgramsScreen } from '@/components/ProgramsScreen';

beforeEach(() => {
  localStorage.clear();
  chatValue.isOpen = false;
});

describe('AI coach icon controls', () => {
  it('names the launcher', () => {
    render(<AIChatBubble />);
    expect(screen.getByRole('button', { name: /open ai coach/i })).toBeTruthy();
  });

  it('names the clear-chat bin once the panel is open', () => {
    chatValue.isOpen = true;
    render(<AIChatBubble />);
    expect(screen.getByRole('button', { name: /clear chat/i })).toBeTruthy();
  });
});

const block = (overrides: Partial<ExerciseBlock> = {}): ExerciseBlock => ({
  exerciseId: 'bench-press' as ExerciseBlock['exerciseId'],
  exerciseName: 'Bench Press',
  restSeconds: 90,
  sets: [{ setNumber: 1, weight: '135', reps: '10', rpe: '', time: '', completed: false, type: 'normal' }],
  ...overrides,
});

const renderTable = (b: ExerciseBlock) =>
  render(
    <ExerciseTable
      weightUnit="lbs"
      distanceUnit="mi"
      stickyNote=""
      activeTimer={null}
      restRecords={{}}
      previousSets={[]}
      inputMode="reps-weight"
      block={b}
      blockIdx={0}
      blocks={[b]}
      onAddSet={vi.fn()}
      onAddDrop={vi.fn()}
      onUpdateDrop={vi.fn()}
      onRemoveSet={vi.fn()}
      onRemoveDrop={vi.fn()}
      onMenuAction={vi.fn()}
      onStartTimer={vi.fn()}
      onSkipTimer={vi.fn()}
      onExtendTimer={vi.fn()}
      onUpdateSet={vi.fn()}
      onToggleComplete={vi.fn()}
    />,
  );

describe('live workout icon controls', () => {
  it('names the exercise three-dot menu after its exercise', () => {
    renderTable(block());
    expect(screen.getByRole('button', { name: 'Options for Bench Press' })).toBeTruthy();
  });

  it('names the set tick and leaves the state to aria-pressed', () => {
    renderTable(block());
    const tick = screen.getByRole('button', { name: 'Set 1 complete' });
    expect(tick.getAttribute('aria-pressed')).toBe('false');
  });

  it("keeps the same name once the set's state flips", () => {
    renderTable(
      block({
        sets: [{ setNumber: 1, weight: '135', reps: '10', rpe: '', time: '', completed: true, type: 'normal' }],
      }),
    );
    const tick = screen.getByRole('button', { name: 'Set 1 complete' });
    expect(tick.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls a warm-up set a warm-up set', () => {
    renderTable(
      block({
        sets: [{ setNumber: 1, weight: '45', reps: '10', rpe: '', time: '', completed: false, type: 'warmup' }],
      }),
    );
    expect(screen.getByRole('button', { name: 'Warm-up set 1 complete' })).toBeTruthy();
  });
});

describe('screen header back arrows', () => {
  it('names the Programs header back button', () => {
    render(
      <ProgramsScreen
        programs={[]}
        templates={[]}
        activeProgramId={null}
        onSetActive={vi.fn()}
        onView={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onShare={vi.fn()}
        onCreate={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });
});
