// Local augmentations for tables/columns not yet reflected in the auto-
// generated `types.ts`. The generated file is regenerated via
// `supabase gen types typescript --linked > src/integrations/supabase/types.ts`
// and should not be edited by hand. This file holds the shapes we depend on
// until the next regen; delete a block from here once the corresponding
// columns/tables appear in `types.ts`.

import type { Database } from './types';

// body_measurements — table missing from the current generated types.
export interface BodyMeasurementRow {
  id: string;
  user_id: string;
  date: string;
  weight_kg: number;
  created_at?: string;
}

export interface BodyMeasurementInsert {
  id?: string;
  user_id: string;
  date: string;
  weight_kg: number;
}

// profiles — the generated Row is missing several columns that exist in the
// actual schema (goal, experience_level, equipment, injuries, age, sex,
// height_cm, subscription_tier). Extend it here so callers can drop the
// `as any` casts around every read.
export type ProfileRowExtended = Database['public']['Tables']['profiles']['Row'] & {
  goal: string | null;
  experience_level: string | null;
  equipment: string[] | null;
  injuries: string[] | null;
  age: number | null;
  sex: string | null;
  height_cm: number | string | null;
  subscription_tier: string | null;
};

export type ProfileInsertExtended = Database['public']['Tables']['profiles']['Insert'] & {
  goal?: string | null;
  experience_level?: string | null;
  equipment?: string[] | null;
  injuries?: string[] | null;
  age?: number | null;
  sex?: string | null;
  height_cm?: number | string | null;
  subscription_tier?: string | null;
};
