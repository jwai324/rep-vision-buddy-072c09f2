
-- 1. Change default weight_unit to 'lbs'
ALTER TABLE public.user_settings ALTER COLUMN weight_unit SET DEFAULT 'lbs';

-- 2. Convert total_volume for lbs users
UPDATE workout_sessions ws
SET total_volume = ROUND((total_volume / 2.20462)::numeric, 2)
WHERE is_rest_day IS NOT TRUE
  AND total_volume > 0
  AND (
    EXISTS (
      SELECT 1 FROM user_settings us
      WHERE us.user_id = ws.user_id AND us.weight_unit = 'lbs'
    )
    OR NOT EXISTS (
      SELECT 1 FROM user_settings us WHERE us.user_id = ws.user_id
    )
  );

-- 3. Convert weight values inside exercises JSONB for lbs users
UPDATE workout_sessions ws
SET exercises = (
  SELECT jsonb_agg(
    CASE
      WHEN ex ? 'sets' THEN
        jsonb_set(
          ex,
          '{sets}',
          (
            SELECT COALESCE(jsonb_agg(
              CASE
                WHEN s ? 'weight' AND (s->>'weight')::numeric > 0
                THEN jsonb_set(s, '{weight}', to_jsonb(ROUND(((s->>'weight')::numeric / 2.20462)::numeric, 2)))
                ELSE s
              END
            ), '[]'::jsonb)
            FROM jsonb_array_elements(ex->'sets') s
          )
        )
      ELSE ex
    END
  )
  FROM jsonb_array_elements(ws.exercises) ex
)
WHERE is_rest_day IS NOT TRUE
  AND jsonb_array_length(exercises) > 0
  AND (
    EXISTS (
      SELECT 1 FROM user_settings us
      WHERE us.user_id = ws.user_id AND us.weight_unit = 'lbs'
    )
    OR NOT EXISTS (
      SELECT 1 FROM user_settings us WHERE us.user_id = ws.user_id
    )
  );
