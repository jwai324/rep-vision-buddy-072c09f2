ALTER TABLE public.user_settings
ADD COLUMN weight_unit text NOT NULL DEFAULT 'kg',
ADD COLUMN default_rest_seconds integer NOT NULL DEFAULT 90;