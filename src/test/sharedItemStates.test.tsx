import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * The public share page is the one screen a stranger ever sees, and every one
 * of its non-happy states is reached through a shape the client does not
 * control: the `get_shared_item` row. A revoked link now comes back with
 * `revoked = true` and *every other column null*
 * (20260921155132_share_reader_privacy_and_view_throttle.sql), so the order in
 * which the page reads the row is load-bearing — checking the payload before
 * the flag turns "no longer available" into "can't open this link", and
 * dereferencing the null payload turns it into a page stuck on "Loading…".
 */

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// A logged-out viewer: the page must render for someone with no account.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mocks.rpc(...args) },
}));

import SharedItem from '@/pages/SharedItem';
import { SHARE_SNAPSHOT_VERSION } from '@/types/share';

const templateSnapshot = (over: Record<string, unknown> = {}) => ({
  version: SHARE_SNAPSHOT_VERSION,
  sharedAt: '2026-09-20T00:00:00.000Z',
  weightUnit: 'kg',
  sharedBy: null,
  customExercises: [],
  kind: 'template',
  template: {
    id: 'tpl-1',
    name: 'Push Day',
    exercises: [{
      exerciseId: 'flat-barbell-bench-press',
      sets: 3,
      targetReps: 10,
      setType: 'normal',
      restSeconds: 90,
    }],
  },
  exerciseMeta: [{ exerciseId: 'flat-barbell-bench-press', name: 'Bench Press', icon: '🏋️' }],
  ...over,
});

const liveRow = (payload: unknown) => ({
  kind: 'template',
  title: 'Push Day',
  payload,
  revoked: false,
  created_at: '2026-09-20T00:00:00.000Z',
  updated_at: '2026-09-20T00:00:00.000Z',
});

const open = () => render(
  <MemoryRouter initialEntries={['/s/tok']}>
    <Routes><Route path="/s/:token" element={<SharedItem />} /></Routes>
  </MemoryRouter>,
);

/** Nothing on the page should still say "Loading…" once the RPC has settled. */
const settled = async () => {
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
};

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mocks.rpc.mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { consoleError.mockRestore(); });

describe('SharedItem — a revoked link', () => {
  const revokedRow = {
    kind: null,
    title: null,
    payload: null,
    revoked: true,
    created_at: null,
    updated_at: null,
  };

  it('says the link is gone, reading the flag before the nulls beside it', async () => {
    mocks.rpc.mockResolvedValue({ data: [revokedRow], error: null });
    open();

    expect(await screen.findByText('This link is no longer available')).toBeInTheDocument();
    // The two states a mis-ordered read lands in: the null payload taken as a
    // snapshot from a newer build, or no row at all.
    expect(screen.queryByText("Can't open this link")).toBeNull();
    expect(screen.queryByText('Link not found')).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('reveals nothing else about the item that was shared', async () => {
    mocks.rpc.mockResolvedValue({ data: [revokedRow], error: null });
    open();
    await screen.findByText('This link is no longer available');

    // The page used to print `A copy of "<title>" …` under every state that
    // carried a row; a revoked row no longer carries one.
    expect(screen.queryByText(/A copy of/)).toBeNull();
    expect(screen.queryByText(/Shared by/)).toBeNull();
  });
});

describe('SharedItem — a link that resolves to nothing', () => {
  it('shows "Link not found" for a token the reader returns no rows for', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    open();

    expect(await screen.findByText('Link not found')).toBeInTheDocument();
  });

  it('shows the same for an rpc that fails, rather than a blank page', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST000', message: 'boom' } });
    open();

    expect(await screen.findByText('Link not found')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('SharedItem — snapshot versions', () => {
  it('refuses a payload written by a newer build instead of rendering it half-way', async () => {
    mocks.rpc.mockResolvedValue({
      data: [liveRow(templateSnapshot({ version: SHARE_SNAPSHOT_VERSION + 1 }))],
      error: null,
    });
    open();

    expect(await screen.findByText("Can't open this link")).toBeInTheDocument();
    expect(screen.getByText(/created by a newer version of RepVision/)).toBeInTheDocument();
    expect(screen.queryByText('Bench Press')).toBeNull();
  });

  it('renders a payload at exactly the version this build knows', async () => {
    mocks.rpc.mockResolvedValue({ data: [liveRow(templateSnapshot())], error: null });
    open();

    expect(await screen.findByText('Bench Press')).toBeInTheDocument();
    expect(screen.queryByText("Can't open this link")).toBeNull();
    expect(screen.getByText(/A copy of "Push Day"/)).toBeInTheDocument();
  });

  it('treats a row whose payload is missing as unreadable rather than crashing', async () => {
    mocks.rpc.mockResolvedValue({ data: [liveRow(null)], error: null });
    open();

    expect(await screen.findByText("Can't open this link")).toBeInTheDocument();
    await settled();
  });
});

describe('SharedItem — who it says shared it', () => {
  it('never puts an email address on the page, even from a payload frozen before the guard', async () => {
    mocks.rpc.mockResolvedValue({
      data: [liveRow(templateSnapshot({ sharedBy: 'justin@example.com' }))],
      error: null,
    });
    open();
    await screen.findByText('Bench Press');

    expect(document.body.textContent).not.toContain('justin@example.com');
    const credit = screen.getByText(/^Shared by /);
    expect(credit.textContent).not.toContain('@');
    expect(credit).toHaveTextContent('Shared by a RepVision user');
  });

  it('still credits a real display name', async () => {
    mocks.rpc.mockResolvedValue({
      data: [liveRow(templateSnapshot({ sharedBy: 'Justin W' }))],
      error: null,
    });
    open();

    expect(await screen.findByText('Shared by Justin W')).toBeInTheDocument();
  });
});
