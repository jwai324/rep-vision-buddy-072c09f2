// Phase 1 stub: simulate an IAP purchase end-to-end without any native/IAP
// infrastructure, so the full purchase -> credit -> spend loop is testable now.
// Secret-gated (x-admin-secret) so it cannot be abused as free credits. Must be
// disabled / hard-gated to an admin before public release (see Phase 2).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { grantPaid } from "../_shared/balance.ts";
import { STUB_PACKS } from "../_shared/pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const expectedSecret = Deno.env.get("GRANT_TOKENS_SECRET");
    const providedSecret = req.headers.get("x-admin-secret");
    if (!expectedSecret || providedSecret !== expectedSecret) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    let callerId: string | null = null;
    if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabase.auth.getUser(token);
      callerId = user?.id ?? null;
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId: string | null = body.target_user_id ?? callerId;
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: "No target user" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let micros: number;
    let reason: string;
    let productId: string;
    if (body.pack && STUB_PACKS[body.pack]) {
      micros = STUB_PACKS[body.pack].micros;
      reason = STUB_PACKS[body.pack].reason;
      productId = body.pack;
    } else if (typeof body.micros === "number" && body.micros > 0) {
      micros = Math.floor(body.micros);
      reason = "admin_grant";
      productId = "custom";
    } else {
      return new Response(JSON.stringify({ error: "Specify a valid pack or micros" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transactionId = `stub:${crypto.randomUUID()}`;

    // Idempotency dress-rehearsal for Phase 2 (transaction_id is UNIQUE).
    const { error: insErr } = await supabase
      .from("iap_purchases")
      .insert({
        user_id: targetUserId,
        platform: "stub",
        product_id: productId,
        transaction_id: transactionId,
        status: "granted",
        granted_micros: micros,
        raw: body,
      });
    if (insErr) {
      return new Response(JSON.stringify({ error: `purchase insert failed: ${insErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newBalance = await grantPaid(supabase, targetUserId, micros, reason, transactionId);

    return new Response(
      JSON.stringify({ ok: true, new_balance_micros: newBalance, granted_micros: micros }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("grant-tokens error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
