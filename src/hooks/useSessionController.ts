import { useRef, useCallback } from 'react';
import { EXERCISES } from '@/types/workout';
import type { ExerciseId, SetType } from '@/types/workout';

interface SetRow {
  setNumber: number;
  weight: string;
  reps: string;
  completed: boolean;
  type: SetType;
  rpe: string;
  time: string;
}

interface ExerciseBlock {
  exerciseId: ExerciseId;
  exerciseName: string;
  sets: SetRow[];
  restSeconds: number;
  dropSetsEnabled?: boolean;
  note?: string;
  supersetGroup?: number;
}

export interface ActiveRestTimerSnapshot {
  status: 'running' | 'paused' | 'completed';
  exerciseIndex: number;
  setIndex?: number;
  durationSeconds: number;
  originalDurationSeconds: number;
  elapsedSeconds: number;
  remainingSeconds: number;
}

export interface SessionMutations {
  addExercise: (exerciseId: ExerciseId, sets?: number, targetReps?: number, weight?: number) => boolean;
  addSets: (exerciseIdentifier: string, count: number) => boolean;
  updateSet: (exerciseName: string, setNumber: number, updates: { weight?: number; reps?: number }) => boolean;
  swapExercise: (currentExerciseName: string, newExerciseId: ExerciseId) => boolean;
  getBlocks: () => ExerciseBlock[];
  getStartTime: () => number;
  getActiveRestTimer: () => ActiveRestTimerSnapshot | null;
}

type RegisterFn = (mutations: SessionMutations) => void;
type UnregisterFn = () => void;

// Singleton controller — shared between ChatContext and ActiveSession
let registeredMutations: SessionMutations | null = null;
const listeners: Set<() => void> = new Set();

// The diff card's Apply button (routed through ChatContext.applyProposal)
// is the ONLY sanctioned writer to session state via the singleton. If
// something else reaches these methods in dev, warn loudly so we catch it.
function assertAllowedSessionWriter(method: string) {
  const stack = new Error().stack ?? '';
  if (!stack.includes('applyProposal')) {
    console.warn(
      `[session-controller] ${method} called outside applyProposal — this should never happen; the diff card's Apply button is the only sanctioned writer.`,
      { stack },
    );
  }
}

export function registerSession(mutations: SessionMutations) {
  if (import.meta.env.DEV) {
    registeredMutations = {
      ...mutations,
      addExercise: (...args) => {
        assertAllowedSessionWriter('addExercise');
        return mutations.addExercise(...args);
      },
      addSets: (...args) => {
        assertAllowedSessionWriter('addSets');
        return mutations.addSets(...args);
      },
      updateSet: (...args) => {
        assertAllowedSessionWriter('updateSet');
        return mutations.updateSet(...args);
      },
      swapExercise: (...args) => {
        assertAllowedSessionWriter('swapExercise');
        return mutations.swapExercise(...args);
      },
    };
  } else {
    registeredMutations = mutations;
  }
  listeners.forEach(fn => fn());
}

export function unregisterSession() {
  registeredMutations = null;
}

export function getSessionController(): SessionMutations | null {
  return registeredMutations;
}

export function isSessionActive(): boolean {
  return registeredMutations !== null;
}
