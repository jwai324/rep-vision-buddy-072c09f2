import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * The public share page has to *show* what the import knows. `importSharedSnapshot`
 * distinguishes "nothing was saved" from "some workouts may have been left in
 * your library", and that distinction is worthless if the page flattens both
 * into one generic line — which is exactly how a retry came to pile up a second
 * copy of every template with no warning.
 */

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  importSharedSnapshot: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'viewer' }, loading: false }),
}));

// The program body is not what's under test, and rendering it would drag in the
// whole exercise library.
vi.mock('@/components/shared/SharedProgramView', () => ({
  SharedProgramView: () => <div data-testid="program-view" />,
}));

const payload = {
  version: 1,
  sharedAt: '2026-09-20T00:00:00.000Z',
  weightUnit: 'kg',
  sharedBy: null,
  customExercises: [],
  kind: 'program',
  program: { id: 'prog', name: 'Block', days: [{ label: 'Day 1', templateId: 'tpl-a' }] },
  templates: [{ id: 'tpl-a', name: 'A', exercises: [] }],
  exerciseMeta: [],
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [{ title: 'Block', revoked: false, payload }], error: null }),
  },
}));

vi.mock('@/utils/shareImport', async () => {
  const actual = await vi.importActual<typeof import('@/utils/shareImport')>('@/utils/shareImport');
  return { ...actual, importSharedSnapshot: mocks.importSharedSnapshot };
});

import SharedItem from '@/pages/SharedItem';
import { IMPORT_FAILED_MESSAGE, IMPORT_LEFTOVERS_MESSAGE, ShareImportError } from '@/utils/shareImport';

const openAndImport = async () => {
  render(
    <MemoryRouter initialEntries={['/s/tok']}>
      <Routes><Route path="/s/:token" element={<SharedItem />} /></Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /save to my workouts/i }));
  await waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
  return mocks.toastError.mock.calls.at(-1)?.[0] as string;
};

describe('SharedItem — what a failed import tells the viewer', () => {
  beforeEach(() => {
    mocks.toastError.mockClear();
    mocks.toastSuccess.mockClear();
    mocks.importSharedSnapshot.mockReset();
  });

  it('warns about workouts left behind when the rollback could not run', async () => {
    mocks.importSharedSnapshot.mockRejectedValue(
      new ShareImportError(IMPORT_LEFTOVERS_MESSAGE, { code: 'PGRST000' }, true),
    );

    expect(await openAndImport()).toBe(IMPORT_LEFTOVERS_MESSAGE);
  });

  it('says nothing was saved when the import cleaned up after itself', async () => {
    mocks.importSharedSnapshot.mockRejectedValue(
      new ShareImportError(IMPORT_FAILED_MESSAGE, { code: 'PGRST000' }, false),
    );

    expect(await openAndImport()).toBe(IMPORT_FAILED_MESSAGE);
  });

  it('falls back to the plain failure for anything that is not a ShareImportError', async () => {
    mocks.importSharedSnapshot.mockRejectedValue(new TypeError('boom'));

    expect(await openAndImport()).toBe(IMPORT_FAILED_MESSAGE);
  });
});
