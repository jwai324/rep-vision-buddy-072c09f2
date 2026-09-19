import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  insert: vi.fn(),
  exercisesLoading: true,
  exercises: [] as unknown[],
  user: { id: 'sharer' },
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: mocks.exercises,
    loading: mocks.exercisesLoading,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

// The lookup for a live share finds none, so the dialog offers "Create link";
// the insert echoes a token back.
vi.mock('@/integrations/supabase/client', () => {
  const lookup = { data: null, error: null };
  const chain = { eq: () => chain, is: () => chain, maybeSingle: () => Promise.resolve(lookup) };
  return {
    supabase: {
      from: () => ({
        select: () => chain,
        insert: (row: unknown) => {
          mocks.insert(row);
          return { select: () => ({ single: () => Promise.resolve({ data: { token: 'tok' }, error: null }) }) };
        },
      }),
    },
  };
});

import { ShareDialog, type ShareTarget } from '@/components/ShareDialog';
import type { TemplateSnapshot } from '@/types/share';

const payload: TemplateSnapshot = {
  version: 1, sharedAt: '', weightUnit: 'kg', sharedBy: null, customExercises: [],
  kind: 'template', template: { id: 'tpl-1', name: 'Push', exercises: [] }, exerciseMeta: [],
};

const target = (): ShareTarget => ({
  kind: 'template',
  sourceId: 'tpl-1',
  title: 'Push',
  buildPayload: vi.fn(() => payload),
});

describe('ShareDialog while the custom library is loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.exercisesLoading = true;
    mocks.exercises = [];
  });

  it('keeps Create link disabled until the library has loaded, then publishes', async () => {
    const t = target();
    const { rerender } = render(<ShareDialog target={t} onClose={vi.fn()} />);

    const button = await screen.findByRole('button', { name: /create link/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(t.buildPayload).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();

    // The library lands after the tap. The payload must be built from it,
    // not from the empty list the screen held when Share was tapped.
    const loaded = [{ id: 'custom-1', name: 'Sled Push' }];
    mocks.exercisesLoading = false;
    mocks.exercises = loaded;
    rerender(<ShareDialog target={t} onClose={vi.fn()} />);
    const ready = await screen.findByRole('button', { name: /create link/i });
    expect(ready).toBeEnabled();
    fireEvent.click(ready);

    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('Link created'));
    expect(t.buildPayload).toHaveBeenCalledTimes(1);
    expect(t.buildPayload).toHaveBeenCalledWith(loaded);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });
});
