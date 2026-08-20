import { describe, it, expect } from 'vitest';
import type { ActiveSessionCache } from '@/types/activeSession';
import { restoredSessionScreen } from '@/utils/sessionRestore';

const cache = (over: Partial<ActiveSessionCache> = {}): ActiveSessionCache => ({
  blocks: [],
  workoutName: 'Push Day 3',
  startTimestamp: 1_700_000_000_000,
  elapsedAtCache: 600,
  ...over,
});

describe('restoredSessionScreen', () => {
  it('has nothing to restore without a cached workout', () => {
    expect(restoredSessionScreen(null)).toBeNull();
  });

  it('carries the template id so the finish flow can still offer the update', () => {
    // Without this the resumed session has no template to compare against and
    // finishes silently, losing whatever was changed mid-workout.
    const screen = restoredSessionScreen(cache({ templateId: 'tpl-123' }));

    expect(screen).toEqual({ type: 'activeSession', exercises: [], templateId: 'tpl-123' });
  });

  it('leaves the template id off a workout that never came from one', () => {
    expect(restoredSessionScreen(cache())).toEqual({ type: 'activeSession', exercises: [] });
    expect(restoredSessionScreen(cache({ templateId: null }))).toEqual({
      type: 'activeSession',
      exercises: [],
    });
  });

  it('restores no exercises — the session rebuilds those from the cached blocks', () => {
    expect(restoredSessionScreen(cache({ templateId: 'tpl-123' }))!.exercises).toEqual([]);
  });
});
