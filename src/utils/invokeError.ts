// functions.invoke reports every non-2xx as "Edge Function returned a non-2xx
// status code" and keeps the response on `context`. The server puts the real
// reason in the body — out of credits (402), reply cut off (422), rate limited
// (429) — and each of those has a different right next step, none of which is
// "press Generate again and pay for another attempt".
//
// Two statuses are deliberately not passed through verbatim: a 5xx body is the
// function's catch-all and can carry an internal message ("ANTHROPIC_API_KEY
// is not configured", a Postgres error), and a 401 from the gateway carries
// `message`, not `error`, and means the session is stale.
export async function describeInvokeError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    if (ctx.status === 401) return new Error('Your session has expired. Sign in again and retry.');
    if (ctx.status >= 500) return new Error('The program generator hit a server error. Try again in a moment.');
    try {
      const body = await ctx.clone().json();
      const sentence = typeof body?.error === 'string' && body.error.trim() ? body.error.trim() : '';
      if (body?.balance_exhausted) {
        return new Error(sentence || "You're out of AI credits. Top up or check your plan to keep generating.");
      }
      if (sentence) return new Error(sentence);
    } catch {
      // Not JSON — fall through to the generic message.
    }
    if (ctx.status === 429) return new Error('The AI is busy right now. Wait a moment and try again.');
  }
  return error instanceof Error ? error : new Error('Failed to generate program. Please try again.');
}
