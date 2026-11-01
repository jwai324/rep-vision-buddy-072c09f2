import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  user: { id: 'test-user' },
}));

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

// Return a referentially stable `user` so the hook's useCallback/useEffect
// dependency chain doesn't re-run on every render and fetchExercises doesn't
// loop forever.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock('@/integrations/supabase/client', () => {
  const ok = { data: [], error: null };
  const changed = { data: [{ id: 'row' }], error: null };
  return {
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ order: () => Promise.resolve(ok) }) }),
        insert: () => Promise.resolve(ok),
        // Updates and deletes are scoped to the owner and read back, so a
        // refusal that changes nothing is not reported as a success.
        update: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve(changed) }) }) }),
        delete: () => ({ eq: () => ({ eq: () => ({ select: () => Promise.resolve(changed) }) }) }),
      }),
    },
  };
});

import { useCustomExercises } from '@/hooks/useCustomExercises';
import type { CustomExerciseInput } from '@/hooks/useCustomExercises';

function makeInput(name: string): CustomExerciseInput {
  return {
    name,
    primaryBodyPart: 'Chest',
    equipment: 'Barbell',
    difficulty: 'Intermediate',
    exerciseType: 'Compound',
    movementPattern: 'Push',
    secondaryMuscles: [],
    isRecovery: false,
    excludeFromVolume: false,
  };
}

describe('useCustomExercises save toasts', () => {
  beforeEach(() => {
    mocks.toastSuccess.mockClear();
    mocks.toastError.mockClear();
  });

  it('addExercise toast names the saved exercise', async () => {
    const { result } = renderHook(() => useCustomExercises());

    await act(async () => {
      await result.current.addExercise(makeInput('Bulgarian Split Squat'));
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Exercise "Bulgarian Split Squat" saved.');
  });

  it('updateExercise toast names the updated exercise', async () => {
    const { result } = renderHook(() => useCustomExercises());

    await act(async () => {
      await result.current.updateExercise('custom-abc', makeInput('Pendlay Row'));
    });

    expect(mocks.toastSuccess).toHaveBeenCalledWith('Exercise "Pendlay Row" updated.');
  });
});
