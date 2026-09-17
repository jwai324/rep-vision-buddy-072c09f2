// functions.invoke reports every non-2xx as "Edge Function returned a non-2xx
// status code" and keeps the response on `context`. The server puts the real
// reason in the body — out of credits (402), reply cut off (422), rate limited
// (429) — and each of those has a different right next step, none of which is
// "press Generate again and pay for another attempt".
export async function describeInvokeError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body?.balance_exhausted) return new Error("You're out of AI credits for this month.");
      if (typeof body?.error === 'string' && body.error.trim()) return new Error(body.error);
    } catch {
      // Not JSON — fall through to the generic message.
    }
    if (ctx.status === 429) return new Error('The AI is busy right now. Wait a moment and try again.');
  }
  return error instanceof Error ? error : new Error('Failed to generate program. Please try again.');
}
