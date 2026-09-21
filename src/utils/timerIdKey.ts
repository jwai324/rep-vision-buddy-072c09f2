import type { TimerId } from '@/components/ExerciseRestTimer';

/**
 * A rest timer's identity as a single string, for the `restRecords` map and
 * the scheduler's live key.
 *
 * It is position-based on purpose: a rest belongs to the row it was started
 * on, and the mutations in `useBlockMutations` move rows under it, so every
 * insert, delete and reorder remaps these keys (`remapTimerIds`) rather than
 * the rest following an exercise id. `parseTimerIdKey` in `useSessionRestTimer`
 * is the inverse and has to stay in step with this shape.
 */
export const timerIdKey = (id: TimerId) => `${id.type}-${id.blockIdx}-${id.setIdx ?? ''}-${id.dropIdx ?? ''}`;
