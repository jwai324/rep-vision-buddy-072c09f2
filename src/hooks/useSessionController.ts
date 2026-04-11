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

export interface SessionMutations {
  addExercise: (exerciseId: ExerciseId, sets?: number, targetReps?: number, weight?: number) => boolean;
  addSets: (exerciseIdentifier: string, count: number) => boolean;
  updateSet: (exerciseName: string, setNumber: number, updates: { weight?: number; reps?: number }) => boolean;
  swapExercise: (currentExerciseName: string, newExerciseId: ExerciseId) => boolean;
  getBlocks: () => ExerciseBlock[];
}

type RegisterFn = (mutations: SessionMutations) => void;
type UnregisterFn = () => void;

// Singleton controller — shared between ChatContext and ActiveSession
let registeredMutations: SessionMutations | null = null;
const listeners: Set<() => void> = new Set();

export function registerSession(mutations: SessionMutations) {
  registeredMutations = mutations;
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
