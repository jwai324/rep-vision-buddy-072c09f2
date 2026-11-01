import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CoachClient } from '@/contexts/CoachContext';
import type { CoachActivityRow } from '@/utils/coachActivity';

type Result = { data: unknown; error: { message: string; code?: string } | null };

interface Call {
  table: string;
  op: 'select' | 'delete';
  filters: [string, string, unknown][];
}

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  rpc: vi.fn(),
  refreshClients: vi.fn(async () => {}),
  actAs: vi.fn(() => true),
  clients: [] as CoachClient[],
  calls: [] as Call[],
  results: {} as Record<string, Result>,
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('@/contexts/CoachContext', () => ({
  useCoach: () => ({
    authUserId: 'me',
    ownerId: 'me',
    actingAs: null,
    clients: mocks.clients,
    clientsLoaded: true,
    ownTier: 'premium',
    refreshClients: mocks.refreshClients,
    actAs: mocks.actAs,
    stopActing: () => true,
    accessLost: () => {},
  }),
}));

interface Chain extends PromiseLike<Result> {
  eq(column: string, value: unknown): Chain;
  is(column: string, value: unknown): Chain;
  gt(column: string, value: unknown): Chain;
  order(column: string, options?: unknown): Chain;
  limit(n: number): Chain;
  range(from: number, to: number): Chain;
  select(columns?: string): Chain;
  maybeSingle(): Promise<Result>;
}

vi.mock('@/integrations/supabase/client', () => {
  const makeChain = (table: string, op: Call['op']): Chain => {
    const call: Call = { table, op, filters: [] };
    mocks.calls.push(call);
    const result = () => Promise.resolve(mocks.results[`${table}:${op}`] ?? { data: null, error: null });
    const chain: Chain = {
      eq: (column, value) => { call.filters.push(['eq', column, value]); return chain; },
      is: (column, value) => { call.filters.push(['is', column, value]); return chain; },
      gt: (column, value) => { call.filters.push(['gt', column, value]); return chain; },
      order: () => chain,
      limit: () => chain,
      range: (from, to) => { call.filters.push(['range', String(from), to]); return chain; },
      select: () => chain,
      maybeSingle: result,
      then: (onFulfilled, onRejected) => result().then(onFulfilled, onRejected),
    };
    return chain;
  };
  return {
    supabase: {
      rpc: (name: string, args?: unknown) => mocks.rpc(name, args),
      from: (table: string) => ({
        select: () => makeChain(table, 'select'),
        delete: () => makeChain(table, 'delete'),
      }),
    },
  };
});

import { CoachingScreen } from '@/components/CoachingScreen';

const DAY = 24 * 60 * 60 * 1000;

const rpcResults: Record<string, Result> = {};

const activityRow = (overrides: Partial<CoachActivityRow>): CoachActivityRow => ({
  id: 'act-1',
  client_id: 'me',
  coach_id: 'coach-1',
  coach_name: 'Coach Bob',
  table_name: 'workout_templates',
  action: 'update',
  row_count: 1,
  labels: [],
  changed_fields: [],
  created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  ...overrides,
});

const renderScreen = () => {
  const onOpenClient = vi.fn();
  render(<CoachingScreen onBack={vi.fn()} onOpenClient={onOpenClient} />);
  return { onOpenClient };
};

describe('CoachingScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls.length = 0;
    mocks.clients = [];
    mocks.results = {
      'coach_invites:select': { data: null, error: null },
      'coach_activity:select': { data: [], error: null },
      'coach_links:delete': { data: [{ id: 'link-9' }], error: null },
    };
    for (const key of Object.keys(rpcResults)) delete rpcResults[key];
    rpcResults.list_my_coaches = { data: [], error: null };
    mocks.rpc.mockImplementation(async (name: string) => rpcResults[name] ?? { data: null, error: null });
  });

  it('mints an invite code and shows it formatted with its expiry', async () => {
    rpcResults.create_coach_invite = {
      data: [{ invite_code: 'ABCDEFGH', invite_expires_at: new Date(Date.now() + 6 * DAY + 60_000).toISOString() }],
      error: null,
    };
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: /invite a coach/i }));

    expect(await screen.findByText('ABCD-EFGH')).toBeInTheDocument();
    expect(screen.getByText(/Expires in 6 days/)).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith('create_coach_invite', undefined);
  });

  it('shows a live code that already exists, looked up for the signed-in user', async () => {
    mocks.results['coach_invites:select'] = {
      data: { code: 'WXYZ2345', created_at: '', expires_at: new Date(Date.now() + 3 * DAY).toISOString(), redeemed_at: null, redeemed_by: null },
      error: null,
    };
    renderScreen();

    expect(await screen.findByText('WXYZ-2345')).toBeInTheDocument();
    const lookup = mocks.calls.find(c => c.table === 'coach_invites' && c.op === 'select');
    expect(lookup?.filters).toContainEqual(['eq', 'client_id', 'me']);
    expect(lookup?.filters).toContainEqual(['is', 'redeemed_at', null]);
  });

  it('redeems the typed code and refreshes the client list', async () => {
    rpcResults.redeem_coach_invite = { data: [{ client_id: 'client-1', client_name: 'Alice' }], error: null };
    renderScreen();

    const input = screen.getByLabelText("Enter a client's code");
    fireEvent.change(input, { target: { value: 'abcd-efgh' } });
    expect(input).toHaveValue('ABCD-EFGH');
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(mocks.refreshClients).toHaveBeenCalled());
    expect(mocks.rpc).toHaveBeenCalledWith('redeem_coach_invite', { p_code: 'ABCDEFGH' });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("You're now coaching Alice");
    expect(input).toHaveValue('');
  });

  it('shows the server\'s refusal and does not refresh', async () => {
    rpcResults.redeem_coach_invite = {
      data: null,
      error: { message: 'That code is invalid or has expired.', code: 'P0002' },
    };
    renderScreen();

    fireEvent.change(screen.getByLabelText("Enter a client's code"), { target: { value: 'ZZZZ ZZZZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is invalid or has expired.');
    expect(mocks.refreshClients).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('removes a coach only after the confirm, deleting the link by id', async () => {
    rpcResults.list_my_coaches = {
      data: [{ link_id: 'link-9', coach_id: 'coach-1', display_name: 'Coach Bob', linked_at: '2026-10-01T00:00:00Z' }],
      error: null,
    };
    renderScreen();

    expect(await screen.findByText('Coach Bob')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/lose access to your account immediately/);
    expect(mocks.calls.some(c => c.table === 'coach_links')).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Removed Coach Bob'));
    const del = mocks.calls.find(c => c.table === 'coach_links' && c.op === 'delete');
    expect(del?.filters).toEqual([['eq', 'id', 'link-9']]);
    await waitFor(() => expect(screen.queryByText('Coach Bob')).not.toBeInTheDocument());
  });

  it('reports a removal that deleted nothing as a failure', async () => {
    rpcResults.list_my_coaches = {
      data: [{ link_id: 'link-9', coach_id: 'coach-1', display_name: 'Coach Bob', linked_at: '2026-10-01T00:00:00Z' }],
      error: null,
    };
    mocks.results['coach_links:delete'] = { data: [], error: null };
    renderScreen();

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Couldn't remove Coach Bob. Try again."));
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('opens a client and stops coaching one behind a confirm', async () => {
    mocks.clients = [{ linkId: 'link-3', clientId: 'client-1', displayName: 'Alice', linkedAt: '2026-10-01T00:00:00Z' }];
    const { onOpenClient } = renderScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpenClient).toHaveBeenCalledWith({ clientId: 'client-1', displayName: 'Alice' });

    fireEvent.click(screen.getByRole('button', { name: 'Stop coaching' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop coaching' }));

    await waitFor(() => expect(mocks.refreshClients).toHaveBeenCalled());
    const del = mocks.calls.find(c => c.table === 'coach_links' && c.op === 'delete');
    expect(del?.filters).toEqual([['eq', 'id', 'link-3']]);
  });

  it('renders the activity log as sentences for the signed-in user only', async () => {
    mocks.results['coach_activity:select'] = {
      data: [
        activityRow({ id: 'a1', labels: ['Push Day'], changed_fields: ['name'] }),
        activityRow({ id: 'a2', table_name: 'future_workouts', action: 'insert', row_count: 84 }),
        activityRow({ id: 'a3', table_name: 'coach_links', action: 'unlinked', labels: ['removed by client'] }),
      ],
      error: null,
    };
    renderScreen();

    expect(await screen.findByText('Coach Bob edited a template')).toBeInTheDocument();
    expect(screen.getByText('Push Day · name')).toBeInTheDocument();
    expect(screen.getByText('Coach Bob added 84 scheduled workouts')).toBeInTheDocument();
    expect(screen.getByText('You removed Coach Bob')).toBeInTheDocument();
    expect(screen.getAllByText('about 2 hours ago').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();

    const query = mocks.calls.find(c => c.table === 'coach_activity');
    expect(query?.filters).toContainEqual(['eq', 'client_id', 'me']);
    expect(query?.filters).toContainEqual(['range', '0', 49]);
  });

  it('offers Load more after a full page and asks for the next one', async () => {
    mocks.results['coach_activity:select'] = {
      data: Array.from({ length: 50 }, (_, i) => activityRow({ id: `p1-${i}` })),
      error: null,
    };
    renderScreen();

    const more = await screen.findByRole('button', { name: 'Load more' });
    mocks.results['coach_activity:select'] = {
      data: [activityRow({ id: 'p2-0', action: 'delete', table_name: 'workout_sessions', labels: ['2026-10-30'] })],
      error: null,
    };
    fireEvent.click(more);

    expect(await screen.findByText('Coach Bob deleted a workout')).toBeInTheDocument();
    expect(screen.getByText('2026-10-30')).toBeInTheDocument();
    const pages = mocks.calls.filter(c => c.table === 'coach_activity');
    expect(pages.at(-1)?.filters).toContainEqual(['range', '50', 99]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument());
  });
});
