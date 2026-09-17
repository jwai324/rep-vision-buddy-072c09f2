import { describe, it, expect } from 'vitest';
import { describeInvokeError } from '@/utils/invokeError';

/** What supabase.functions.invoke hands back for a non-2xx: a generic Error with the Response on `context`. */
const httpError = (status: number, body: unknown) =>
  Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(body == null ? null : JSON.stringify(body), { status }),
  });

describe('describeInvokeError', () => {
  it('names running out of credits, so the user does not retry and pay again', async () => {
    const e = await describeInvokeError(httpError(402, { error: "You're out of AI credits.", balance_exhausted: true }));
    expect(e.message).toMatch(/out of AI credits/);
  });

  it("surfaces the server's own sentence for a cut-off reply", async () => {
    const e = await describeInvokeError(httpError(422, { error: 'AI response was too long and got cut off. Try reducing days or session duration.' }));
    expect(e.message).toMatch(/too long and got cut off/);
  });

  it('explains a rate limit even when the body is not JSON', async () => {
    const e = await describeInvokeError(httpError(429, null));
    expect(e.message).toMatch(/busy right now/);
  });

  it('falls back to the generic message for an unknown failure', async () => {
    const e = await describeInvokeError(httpError(500, 'not json at all' as unknown));
    expect(e.message).toBe('Edge Function returned a non-2xx status code');
  });

  it('passes a plain Error through untouched', async () => {
    const e = await describeInvokeError(new TypeError('Failed to fetch'));
    expect(e.message).toBe('Failed to fetch');
  });
});
