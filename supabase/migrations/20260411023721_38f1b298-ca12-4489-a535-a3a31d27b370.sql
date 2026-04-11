
-- AI usage tracking table
CREATE TABLE public.user_ai_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  date text NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD'),
  message_count integer NOT NULL DEFAULT 0,
  total_input_tokens integer NOT NULL DEFAULT 0,
  total_output_tokens integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.user_ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage" ON public.user_ai_usage FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own usage" ON public.user_ai_usage FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own usage" ON public.user_ai_usage FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_user_ai_usage_updated_at
  BEFORE UPDATE ON public.user_ai_usage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- AI error log table
CREATE TABLE public.ai_error_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  error_type text NOT NULL,
  request_size_tokens integer DEFAULT 0,
  error_message text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_error_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own errors" ON public.ai_error_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own errors" ON public.ai_error_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Service role policy for edge functions to insert/update usage
CREATE POLICY "Service role full access usage" ON public.user_ai_usage FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access errors" ON public.ai_error_log FOR ALL USING (true) WITH CHECK (true);

-- Admin monitoring view
CREATE OR REPLACE VIEW public.ai_usage_daily_summary AS
SELECT
  date,
  count(*) as total_users,
  sum(message_count) as total_calls,
  round(avg(total_input_tokens)) as avg_input_tokens,
  round(avg(total_output_tokens)) as avg_output_tokens,
  round(sum(total_input_tokens) * 0.000001 + sum(total_output_tokens) * 0.000003, 4) as estimated_cost_usd
FROM public.user_ai_usage
GROUP BY date
ORDER BY date DESC;
