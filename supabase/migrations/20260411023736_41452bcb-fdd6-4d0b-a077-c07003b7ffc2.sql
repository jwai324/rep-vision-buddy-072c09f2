
-- Drop overly permissive policies
DROP POLICY "Service role full access usage" ON public.user_ai_usage;
DROP POLICY "Service role full access errors" ON public.ai_error_log;

-- Replace with service-role-specific policies
CREATE POLICY "Service role can manage usage" ON public.user_ai_usage
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role can manage errors" ON public.ai_error_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Fix view security
DROP VIEW IF EXISTS public.ai_usage_daily_summary;
CREATE VIEW public.ai_usage_daily_summary WITH (security_invoker = on) AS
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
