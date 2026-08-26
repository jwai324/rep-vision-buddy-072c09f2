import { describe, it, expect, vi, afterEach } from 'vitest';
import { EXERCISE_DATABASE } from '@/data/exercises';
import {
  getExerciseInputMode,
  formatSetDisplay,
  getMeasurementBadge,
  isTimeBased,
  isDistanceBased,
  usesReps,
  usesWeight,
} from '@/utils/exerciseInputMode';
import { canCompleteSet, getSetFieldErrors } from '@/utils/setValidation';

const byId = (id: string) => EXERCISE_DATABASE.find(e => e.id === id);

afterEach(() => vi.restoreAllMocks());

describe('loaded isometric holds (Time + Weight)', () => {
  it('maps the measurement type to the weight-time input mode', () => {
    expect(getExerciseInputMode('plank')).toBe('weight-time');
    expect(getExerciseInputMode('towel-hang')).toBe('weight-time');
  });

  it('asks for weight and time, but not reps or distance', () => {
    expect(usesWeight('weight-time')).toBe(true);
    expect(isTimeBased('weight-time')).toBe(true);
    expect(usesReps('weight-time')).toBe(false);
    expect(isDistanceBased('weight-time')).toBe(false);
  });

  it('completes on duration alone, so a bodyweight hold needs no load', () => {
    expect(canCompleteSet('', '', 'kg', false, '60', 'weight-time')).toBe(true);
    expect(canCompleteSet('20', '', 'kg', false, '60', 'weight-time')).toBe(true);
  });

  it('will not complete without a duration, however loaded', () => {
    expect(canCompleteSet('20', '', 'kg', false, '', 'weight-time')).toBe(false);
    expect(canCompleteSet('20', '', 'kg', false, '0', 'weight-time')).toBe(false);
  });

  it('validates a typed weight the same as any other loaded mode', () => {
    expect(getSetFieldErrors({ weight: '-5' }, 'kg', 'weight-time').weight).toBeTruthy();
    expect(getSetFieldErrors({ weight: '20' }, 'kg', 'weight-time').weight).toBeUndefined();
    // Reps aren't part of this mode, so a stale value must not block the set.
    expect(getSetFieldErrors({ reps: '99999' }, 'kg', 'weight-time').reps).toBeUndefined();
  });

  it('displays the load next to the hold, and drops it when unweighted', () => {
    expect(formatSetDisplay('weight-time', { reps: 1, weight: 20, time: 90 }, 'kg')).toBe('20 kg · 1:30');
    expect(formatSetDisplay('weight-time', { reps: 1, time: 90 }, 'kg')).toBe('1:30');
    expect(formatSetDisplay('weight-time', { reps: 1, weight: 0, time: 45 }, 'kg')).toBe('0:45');
  });

  it('carries its own picker badge', () => {
    expect(getMeasurementBadge('weight-time')).toEqual({ icon: '🏋⏱', label: 'Weight+Time' });
  });

  it('tags the isometric holds that are commonly loaded', () => {
    for (const id of ['plank', 'side-plank', 'trx-plank', 'swiss-ball-plank', 'copenhagen-plank', 'towel-hang']) {
      expect(byId(id)?.measurementType, id).toBe('Time + Weight');
    }
  });

  it('keeps timed recovery work on the plain Time measurement', () => {
    for (const id of ['sauna', 'meditation', 'yoga', 'foam-rolling', 'breathing-exercises']) {
      expect(byId(id)?.measurementType, id).toBe('Time');
      expect(getExerciseInputMode(id), id).toBe('time');
    }
  });
});

describe('optional load on rep- and time-based work', () => {
  it('offers a weight field wherever reps or time are logged', () => {
    for (const mode of ['reps', 'reps-weight', 'time', 'weight-time', 'band'] as const) {
      expect(usesWeight(mode), mode).toBe(true);
    }
  });

  it('keeps the load column off distance work, whose number is kilometres', () => {
    expect(usesWeight('distance')).toBe(false);
    expect(usesWeight('time-distance')).toBe(false);
  });

  it('never makes that load a condition of completing the set', () => {
    // Reps and duration still gate completion; the load is extra.
    expect(canCompleteSet('', '12', 'kg', false, '', 'reps')).toBe(true);
    expect(canCompleteSet('', '', 'kg', false, '45', 'time')).toBe(true);
    expect(canCompleteSet('', '', 'kg', false, '', 'reps')).toBe(false);
    expect(canCompleteSet('', '', 'kg', false, '', 'time')).toBe(false);
  });

  it('validates a load typed onto a rep- or time-based set', () => {
    expect(getSetFieldErrors({ weight: '-5' }, 'kg', 'reps').weight).toBeTruthy();
    expect(getSetFieldErrors({ weight: '-5' }, 'kg', 'time').weight).toBeTruthy();
    expect(getSetFieldErrors({ weight: '20' }, 'kg', 'reps').weight).toBeUndefined();
  });

  it('shows the load once it is there, and reads as before without it', () => {
    expect(formatSetDisplay('reps', { reps: 12, weight: 10 }, 'kg')).toBe('10 kg × 12');
    expect(formatSetDisplay('reps', { reps: 12 }, 'kg')).toBe('12 reps');
    expect(formatSetDisplay('time', { reps: 1, weight: 24, time: 45 }, 'kg')).toBe('24 kg · 0:45');
    expect(formatSetDisplay('time', { reps: 1, time: 45 }, 'kg')).toBe('0:45');
  });

  it('leaves the picker badges keyed to the measurement, not the load', () => {
    expect(getMeasurementBadge('reps')).toEqual({ icon: '#', label: 'Reps' });
    expect(getMeasurementBadge('time')).toEqual({ icon: '⏱', label: 'Time' });
  });
});

describe('cardio measurement types', () => {
  it('gives distance-covering cardio both a time and a distance field', () => {
    for (const id of ['running-steady-state', 'rowing-machine', 'cycling-outdoor', 'elliptical', 'hiking']) {
      expect(getExerciseInputMode(id), id).toBe('time-distance');
      expect(isTimeBased(getExerciseInputMode(id)), id).toBe(true);
      expect(isDistanceBased(getExerciseInputMode(id)), id).toBe(true);
    }
  });

  it('keeps stationary cardio and field sports on time alone', () => {
    for (const id of ['jump-rope', 'high-knees', 'basketball', 'soccer', 'tennis']) {
      expect(getExerciseInputMode(id), id).toBe('time');
      expect(isDistanceBased(getExerciseInputMode(id)), id).toBe(false);
    }
  });

  it('no longer falls back to the legacy cardio heuristic', () => {
    // The fallback warns on every lookup, so an untagged cardio entry is a
    // console-noise regression as much as a data one.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const untagged = EXERCISE_DATABASE.filter(e => e.primaryBodyPart === 'Cardio' && !e.measurementType);
    expect(untagged.map(e => e.id)).toEqual([]);

    for (const ex of EXERCISE_DATABASE.filter(e => e.primaryBodyPart === 'Cardio')) {
      getExerciseInputMode(ex.id);
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
