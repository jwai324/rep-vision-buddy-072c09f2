import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertResult: { data: null, error: null as null | { message: string } },
  rows: [] as unknown[],
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  user: { id: 'user-1' },
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      insert: (row: unknown) => {
        mocks.insert(row);
        return Promise.resolve(mocks.insertResult);
      },
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: mocks.rows, error: null }),
          }),
        }),
      }),
    }),
  },
}));

import { ErrorReportButton } from '@/components/ErrorReportButton';
import { recordError, clearRecentErrors } from '@/utils/consoleErrorBuffer';

async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
  return screen.findByRole('button', { name: /send report/i });
}

describe('ErrorReportButton', () => {
  beforeEach(() => {
    mocks.insert.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
    mocks.insertResult = { data: null, error: null };
    mocks.rows = [];
    clearRecentErrors();
    localStorage.clear();
  });

  it('files a report carrying the screen, build, and recent console errors', async () => {
    recordError('console.error', '[useStorage] load error: timeout');
    render(<ErrorReportButton screen="templates" />);

    const send = await openSheet();
    expect(send).toBeDisabled();

    fireEvent.click(screen.getByRole('radio', { name: 'Correction' }));
    fireEvent.change(screen.getByLabelText('What happened'), {
      target: { value: 'Rest timer shows 90s but the template says 60s' },
    });
    fireEvent.change(screen.getByLabelText('What should happen instead'), {
      target: { value: 'Use the template rest time' },
    });
    expect(send).toBeEnabled();
    fireEvent.click(send);

    await waitFor(() => expect(mocks.insert).toHaveBeenCalledTimes(1));
    const row = mocks.insert.mock.calls[0][0];
    expect(row).toMatchObject({
      user_id: 'user-1',
      kind: 'correction',
      description: 'Rest timer shows 90s but the template says 60s',
      expected: 'Use the template rest time',
      screen: 'templates',
      app_version: 'test',
    });
    expect(row.context.recentErrors).toEqual([
      expect.objectContaining({ source: 'console.error', message: '[useStorage] load error: timeout' }),
    ]);
    expect(mocks.toastSuccess).toHaveBeenCalled();
    expect(localStorage.getItem('error-report-draft')).toBeNull();
  });

  it('keeps the draft and says so when the insert fails', async () => {
    mocks.insertResult = { data: null, error: { message: 'network' } };
    render(<ErrorReportButton screen="dashboard" />);

    const send = await openSheet();
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Streak counter is off by one' } });
    fireEvent.click(send);

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
    expect(screen.getByLabelText('What happened')).toHaveValue('Streak counter is off by one');
    expect(localStorage.getItem('error-report-draft')).toBe('Streak counter is off by one');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('shows the triage note on a report that needs the user’s decision', async () => {
    mocks.rows = [
      {
        id: 'r1',
        kind: 'bug',
        description: 'Volume chart drops my kettlebell swings',
        status: 'needs_review',
        triage_notes: 'Two readings possible. Decision needed: count swings as volume or not?',
        created_at: '2026-09-04T10:00:00Z',
      },
      {
        id: 'r2',
        kind: 'correction',
        description: 'Typo on settings screen',
        status: 'new',
        triage_notes: null,
        created_at: '2026-09-04T11:00:00Z',
      },
    ];
    render(<ErrorReportButton screen="settings" />);
    await openSheet();

    expect(await screen.findByText('Needs your call')).toBeInTheDocument();
    expect(screen.getByText(/count swings as volume or not/)).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });
});
