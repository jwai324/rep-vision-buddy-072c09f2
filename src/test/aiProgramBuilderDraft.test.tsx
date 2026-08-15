import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/ChatContext', () => ({
  useChatContext: () => ({ refreshBalance: vi.fn() }),
}));

import { AIProgramBuilder } from '@/components/AIProgramBuilder';

const noopProps = { onBack: vi.fn(), onSaveProgram: vi.fn() };

describe('AIProgramBuilder draft caching', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('resumes at the same step with earlier answers after leaving and coming back', async () => {
    const first = render(<AIProgramBuilder {...noopProps} />);
    await screen.findByText("What's your primary training goal?");

    fireEvent.click(screen.getByRole('button', { name: 'Hypertrophy' }));
    await screen.findByText('How long have you been training consistently?');

    first.unmount();
    render(<AIProgramBuilder {...noopProps} />);

    // Transcript and position survive the remount — no re-asking from step 1.
    expect(await screen.findByText('How long have you been training consistently?')).toBeInTheDocument();
    expect(screen.getByText('Hypertrophy')).toBeInTheDocument();
    expect(screen.queryByText("What's your primary training goal?")).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 9')).toBeInTheDocument();
  });

  it('keeps text typed into the free-text box but not submitted', async () => {
    const first = render(<AIProgramBuilder {...noopProps} />);
    await screen.findByText("What's your primary training goal?");

    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.change(screen.getByPlaceholderText('Type your answer...'), {
      target: { value: 'powerbuilding' },
    });

    first.unmount();
    render(<AIProgramBuilder {...noopProps} />);

    const restoredInput = await screen.findByPlaceholderText('Type your answer...');
    expect(restoredInput).toHaveValue('powerbuilding');
  });

  it('re-asks the pending question when the flow is interrupted mid-answer', async () => {
    const first = render(<AIProgramBuilder {...noopProps} />);
    await screen.findByText("What's your primary training goal?");

    // Unmount inside the typing delay, before the next question is appended.
    fireEvent.click(screen.getByRole('button', { name: 'Strength' }));
    first.unmount();

    render(<AIProgramBuilder {...noopProps} />);
    expect(await screen.findByText('How long have you been training consistently?')).toBeInTheDocument();
    expect(screen.getByText('Strength')).toBeInTheDocument();
  });

  it('starts over on request and drops the cached draft', async () => {
    render(<AIProgramBuilder {...noopProps} />);
    await screen.findByText("What's your primary training goal?");
    fireEvent.click(screen.getByRole('button', { name: 'Hypertrophy' }));
    await screen.findByText('How long have you been training consistently?');

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));

    await waitFor(() => {
      expect(screen.queryByText('Hypertrophy')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Step 1 of 9')).toBeInTheDocument();
  });

  it('ignores a cached review draft with no generated program', async () => {
    localStorage.setItem(
      'ai_program_builder_draft',
      JSON.stringify({ version: 1, phase: 'review', currentStep: 9, messages: [{ role: 'ai', content: 'stale' }], generatedProgram: null }),
    );
    render(<AIProgramBuilder {...noopProps} />);
    expect(await screen.findByText("What's your primary training goal?")).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });

  it('ignores a draft written by an older version', async () => {
    localStorage.setItem(
      'ai_program_builder_draft',
      JSON.stringify({ version: 0, phase: 'chat', currentStep: 2, messages: [{ role: 'ai', content: 'stale' }] }),
    );
    render(<AIProgramBuilder {...noopProps} />);
    expect(await screen.findByText("What's your primary training goal?")).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
  });
});
