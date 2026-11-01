import { describe, it, expect } from 'vitest';
import { describeActivity, humaniseField, type CoachActivityRow } from '@/utils/coachActivity';

const row = (overrides: Partial<CoachActivityRow>): CoachActivityRow => ({
  id: 'a1',
  client_id: 'client',
  coach_id: 'coach',
  coach_name: 'Coach Bob',
  table_name: 'workout_templates',
  action: 'update',
  row_count: 1,
  labels: [],
  changed_fields: [],
  created_at: '2026-10-31T10:00:00Z',
  ...overrides,
});

describe('describeActivity', () => {
  it('describes an edit with its label and the fields it changed', () => {
    expect(describeActivity(row({ labels: ['Push Day'], changed_fields: ['name'] }))).toEqual({
      headline: 'Coach Bob edited a template',
      detail: 'Push Day · name',
    });
  });

  it('humanises snake_case field names', () => {
    const { detail } = describeActivity(row({
      table_name: 'user_settings',
      changed_fields: ['weight_unit', 'rest_timer_seconds'],
    }));
    expect(detail).toBe('weight unit, rest timer seconds');
    expect(humaniseField('streak_adjustment__target')).toBe('streak adjustment target');
  });

  it('pluralises an insert by row count', () => {
    const { headline } = describeActivity(row({
      table_name: 'future_workouts', action: 'insert', row_count: 84,
    }));
    expect(headline).toBe('Coach Bob added 84 scheduled workouts');
  });

  it('uses the irregular plural for bodyweight entries', () => {
    expect(describeActivity(row({ table_name: 'body_measurements', action: 'insert', row_count: 3 })).headline)
      .toBe('Coach Bob added 3 bodyweight entries');
  });

  it('describes a single delete with its date label', () => {
    expect(describeActivity(row({
      table_name: 'workout_sessions', action: 'delete', labels: ['2026-10-30'],
    }))).toEqual({ headline: 'Coach Bob deleted a workout', detail: '2026-10-30' });
  });

  it('shows at most five labels and marks a batch that had more', () => {
    const labels = ['a', 'b', 'c', 'd', 'e', 'f'];
    const { detail } = describeActivity(row({ action: 'insert', row_count: 12, labels }));
    expect(detail).toBe('a, b, c, d, e, …');
  });

  it('describes a link being made', () => {
    expect(describeActivity(row({ table_name: 'coach_links', action: 'linked', row_count: 1 }))).toEqual({
      headline: 'Coach Bob connected',
      detail: null,
    });
  });

  it('says who ended a link', () => {
    expect(describeActivity(row({ table_name: 'coach_links', action: 'unlinked', labels: ['removed by client'] })).headline)
      .toBe('You removed Coach Bob');
    expect(describeActivity(row({ table_name: 'coach_links', action: 'unlinked', labels: ['left by coach'] })).headline)
      .toBe('Coach Bob stopped coaching you');
  });

  it('names a coach whose account is gone as a former coach', () => {
    expect(describeActivity(row({ coach_name: null, action: 'delete', table_name: 'workout_programs' })).headline)
      .toBe('A former coach deleted a program');
    expect(describeActivity(row({ coach_name: null, action: 'unlinked', labels: ['removed by client'] })).headline)
      .toBe('You removed a former coach');
  });

  it('speaks of the client\'s own profile and settings rather than counting them', () => {
    expect(describeActivity(row({ table_name: 'profiles', changed_fields: ['display_name'] }))).toEqual({
      headline: 'Coach Bob edited your profile',
      detail: 'display name',
    });
    expect(describeActivity(row({ table_name: 'user_settings' })).headline).toBe('Coach Bob edited your settings');
  });

  it('has no detail when there is nothing to add', () => {
    expect(describeActivity(row({ table_name: 'custom_exercises', action: 'insert' }))).toEqual({
      headline: 'Coach Bob added a custom exercise',
      detail: null,
    });
  });
});
