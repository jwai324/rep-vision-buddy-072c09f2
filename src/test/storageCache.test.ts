import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readStorageCache, writeStorageCache, clearStorageCache, type CachedStorage } from '@/utils/storageCache';
import type { WorkoutSession } from '@/types/workout';

const USER_A = 'user-a';
const USER_B = 'user-b';

const session = (id: string): WorkoutSession => ({
  id,
  date: '2026-08-15',
  exercises: [],
  duration: 1800,
  totalVolume: 100,
  totalSets: 3,
  totalReps: 30,
});

const snapshot = (over: Partial<CachedStorage> = {}): CachedStorage => ({
  history: [session('s1')],
  templates: [{ id: 't1', name: 'Push', exercises: [] }],
  programs: [],
  activeProgramId: null,
  futureWorkouts: [],
  preferences: {
    weightUnit: 'lbs', defaultRestSeconds: 90, defaultDropSetsEnabled: false,
    streakMode: 'daily', streakWeeklyTarget: 3, streakAdjustment: 0,
    streakAdjustmentSetAt: null, tutorialCompleted: true, hideTimers: false,
    customLocations: ['Home Gym'], stickyNotes: {},
  },
  profile: {
    displayName: null, goal: null, hybridGoals: [], coachNotes: null,
    experienceLevel: null, equipment: [], injuries: [], age: null,
    sex: null, heightCm: null, subscriptionTier: 'premium',
  },
  bodyMeasurements: [],
  ...over,
});

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('storageCache round-trip', () => {
  it('reads back what it wrote', () => {
    writeStorageCache(USER_A, snapshot());
    const read = readStorageCache(USER_A);
    expect(read?.history).toHaveLength(1);
    expect(read?.templates[0].name).toBe('Push');
    expect(read?.preferences.tutorialCompleted).toBe(true);
  });

  it('misses for a user with nothing cached', () => {
    expect(readStorageCache(USER_A)).toBeNull();
  });

  it('never serves one account the other account snapshot', () => {
    writeStorageCache(USER_A, snapshot());
    expect(readStorageCache(USER_B)).toBeNull();
  });

  it('evicts the previous account snapshot when a new one is written', () => {
    writeStorageCache(USER_A, snapshot());
    writeStorageCache(USER_B, snapshot());
    expect(readStorageCache(USER_A)).toBeNull();
    expect(readStorageCache(USER_B)).not.toBeNull();
  });

  it('clears everything on sign-out', () => {
    writeStorageCache(USER_A, snapshot());
    clearStorageCache();
    expect(readStorageCache(USER_A)).toBeNull();
  });
});

describe('storageCache is a cache, never a source of truth', () => {
  it('treats a corrupt payload as a miss instead of throwing', () => {
    localStorage.setItem('repvision:storage:v1:' + USER_A, '{not json');
    expect(() => readStorageCache(USER_A)).not.toThrow();
    expect(readStorageCache(USER_A)).toBeNull();
  });

  it('treats a payload missing expected arrays as a miss', () => {
    // A screen reading `.history.map` on this would crash deep in the tree.
    localStorage.setItem('repvision:storage:v1:' + USER_A, JSON.stringify({ templates: [] }));
    expect(readStorageCache(USER_A)).toBeNull();
  });

  it('survives a write failing on a full disk, leaving no partial entry', () => {
    writeStorageCache(USER_A, snapshot());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => writeStorageCache(USER_A, snapshot())).not.toThrow();
    vi.restoreAllMocks();
    expect(readStorageCache(USER_A)).toBeNull();
  });

  it('caps the cached history so a long log cannot bloat the write', () => {
    const long = Array.from({ length: 500 }, (_, i) => session(`s${i}`));
    writeStorageCache(USER_A, snapshot({ history: long }));

    const read = readStorageCache(USER_A);
    expect(read!.history).toHaveLength(200);
    // Keeps the most recent, since history arrives newest-first.
    expect(read!.history[0].id).toBe('s0');
  });

  it('skips oversized payloads rather than writing them', () => {
    const huge = Array.from({ length: 200 }, (_, i) => ({
      ...session(`s${i}`),
      note: 'x'.repeat(20_000),
    }));
    writeStorageCache(USER_A, snapshot({ history: huge }));
    expect(readStorageCache(USER_A)).toBeNull();
  });
});
