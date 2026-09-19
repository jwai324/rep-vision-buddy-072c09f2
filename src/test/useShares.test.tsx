import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { TemplateSnapshot } from '@/types/share';

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  insert: vi.fn(),
  insertResult: { data: { token: 'tok' } as { token: string } | null, error: null as { code?: string } | null },
  user: { id: 'sharer' },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

// No live share exists, so every publish is an insert.
vi.mock('@/integrations/supabase/client', () => {
  const lookup = { data: null, error: null };
  const chain = { eq: () => chain, is: () => chain, maybeSingle: () => Promise.resolve(lookup) };
  return {
    supabase: {
      from: () => ({
        select: () => chain,
        insert: (row: unknown) => {
          mocks.insert(row);
          return { select: () => ({ single: () => Promise.resolve(mocks.insertResult) }) };
        },
      }),
    },
  };
});

import { useShares } from '@/hooks/useShares';

const payload: TemplateSnapshot = {
  version: 1, sharedAt: '', weightUnit: 'kg', sharedBy: null, customExercises: [],
  kind: 'template', template: { id: 'tpl-1', name: 'Push', exercises: [] }, exerciseMeta: [],
};

describe('useShares.createOrUpdateShare against the table constraints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insertResult = { data: { token: 'tok' }, error: null };
  });

  it('clamps the title to 200 characters, counting code points', async () => {
    const { result } = renderHook(() => useShares({ autoFetch: false }));
    // 199 letters plus an emoji is 200 characters but 201 UTF-16 units; a
    // unit-based slice would keep half the emoji.
    const title = `  ${'a'.repeat(199)}😀 extra`;
    const token = await result.current.createOrUpdateShare({ kind: 'template', sourceId: 'tpl-1', title, payload });

    expect(token).toBe('tok');
    const row = mocks.insert.mock.calls[0][0] as { title: string };
    expect(Array.from(row.title)).toHaveLength(200);
    expect(row.title).toBe(`${'a'.repeat(199)}😀`);
  });

  it('reads a check violation as the server refusing the size, not a generic failure', async () => {
    mocks.insertResult = { data: null, error: { code: '23514' } };
    const { result } = renderHook(() => useShares({ autoFetch: false }));
    const token = await result.current.createOrUpdateShare({ kind: 'template', sourceId: 'tpl-1', title: 'Push', payload });

    expect(token).toBeNull();
    expect(mocks.toastError).toHaveBeenCalledWith('This is too large to share.');
  });
});
