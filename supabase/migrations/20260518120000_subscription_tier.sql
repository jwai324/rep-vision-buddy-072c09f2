-- Subscription tier (free | premium). Defaults to 'premium' while the app is
-- in testing so users aren't gated by the credit system. Free-tier users are
-- metered against the token-credit balance; premium bypasses the credit gate.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'premium';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_tier_check
    CHECK (subscription_tier IN ('free','premium'));
