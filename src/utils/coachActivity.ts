import type { Database } from '@/integrations/supabase/types';

export type CoachActivityRow = Database['public']['Tables']['coach_activity']['Row'];

export interface ActivityDescription {
  headline: string;
  detail: string | null;
}

interface Noun {
  one: string;
  many: string;
}

const NOUNS: Record<string, Noun> = {
  workout_templates: { one: 'template', many: 'templates' },
  workout_programs: { one: 'program', many: 'programs' },
  future_workouts: { one: 'scheduled workout', many: 'scheduled workouts' },
  workout_sessions: { one: 'workout', many: 'workouts' },
  body_measurements: { one: 'bodyweight entry', many: 'bodyweight entries' },
  custom_exercises: { one: 'custom exercise', many: 'custom exercises' },
};

// One row per account, so "a profile" or "2 settings" would read wrong.
const OWN_TABLES: Record<string, string> = {
  profiles: 'your profile',
  user_settings: 'your settings',
};

const VERBS: Record<string, string> = {
  insert: 'added',
  update: 'edited',
  delete: 'deleted',
};

const MAX_LABELS = 5;

export const humaniseField = (field: string) => field.replace(/_+/g, ' ').trim();

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

function objectPhrase(tableName: string, rowCount: number): string {
  const own = OWN_TABLES[tableName];
  if (own) return own;
  const noun = NOUNS[tableName] ?? { one: 'record', many: 'records' };
  return rowCount > 1 ? `${rowCount} ${noun.many}` : `${article(noun.one)} ${noun.one}`;
}

function detailOf(row: CoachActivityRow): string | null {
  const labels = (row.labels ?? []).filter(Boolean).slice(0, MAX_LABELS);
  // The server keeps at most five distinct labels, so a full set over a
  // larger batch means some were left out.
  const truncated = labels.length === MAX_LABELS && row.row_count > MAX_LABELS;
  const parts: string[] = [];
  if (labels.length > 0) parts.push(labels.join(', ') + (truncated ? ', …' : ''));
  const fields = (row.changed_fields ?? []).map(humaniseField).filter(Boolean);
  if (fields.length > 0) parts.push(fields.join(', '));
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function describeActivity(row: CoachActivityRow): ActivityDescription {
  const name = row.coach_name?.trim() || null;
  const subject = name ?? 'A former coach';

  if (row.action === 'linked') {
    return { headline: `${subject} connected`, detail: null };
  }

  if (row.action === 'unlinked') {
    const removedByClient = row.labels?.[0] === 'removed by client';
    if (removedByClient) {
      return { headline: `You removed ${name ?? 'a former coach'}`, detail: null };
    }
    return { headline: `${subject} stopped coaching you`, detail: null };
  }

  const verb = VERBS[row.action] ?? 'changed';
  return {
    headline: `${subject} ${verb} ${objectPhrase(row.table_name, row.row_count)}`,
    detail: detailOf(row),
  };
}
