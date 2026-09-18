import { describe, it, expect } from 'vitest';
import { describeInvokeError } from '@/utils/invokeError';

/** What supabase.functions.invoke hands back for a non-2xx: a generic Error with the Response on `context`. */
const httpError = (status: number, body: unknown) =>
  Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    context: new Response(body == null ? null : JSON.stringify(body), { status }),
  });

describe('describeInvokeError', () => {
  it("names running out of credits in the server's own words, so the user does not retry and pay again", async () => {
    const e = await describeInvokeError(httpError(402, { error: "You're out of AI credits.", balance_exhausted: true }));
    expect(e.message).toBe("You're out of AI credits.");
  });

  it('does not promise a monthly reset when the server says nothing about one', async () => {
    const e = await describeInvokeError(httpError(402, { balance_exhausted: true }));
    expect(e.message).toMatch(/out of AI credits/);
    expect(e.message).not.toMatch(/month/);
  });

  it("keeps a 5xx body's internals off the screen", async () => {
    const e = await describeInvokeError(httpError(500, { error: 'ANTHROPIC_API_KEY is not configured' }));
    expect(e.message).not.toMatch(/ANTHROPIC/);
    expect(e.message).toMatch(/server error/);
  });

  it("reads the gateway's 401, which has no error field, as an expired session", async () => {
    const e = await describeInvokeError(httpError(401, { code: 401, message: 'Invalid JWT' }));
    expect(e.message).toMatch(/session has expired/);
  });

  it("surfaces the server's own sentence for a cut-off reply", async () => {
    const e = await describeInvokeError(httpError(422, { error: 'AI response was too long and got cut off. Try reducing days or session duration.' }));
    expect(e.message).toMatch(/too long and got cut off/);
  });

  it('explains a rate limit even when the body is not JSON', async () => {
    const e = await describeInvokeError(httpError(429, null));
    expect(e.message).toMatch(/busy right now/);
  });

  it('falls back to the generic message when the body is not JSON', async () => {
    // A gateway's HTML error page, not a JSON string: this is what makes
    // clone().json() reject and exercises the catch branch.
    const e = await describeInvokeError(Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response('<html><body>Bad Gateway</body></html>', { status: 404 }),
    }));
    expect(e.message).toBe('Edge Function returned a non-2xx status code');
  });

  it('passes a plain Error through untouched', async () => {
    const e = await describeInvokeError(new TypeError('Failed to fetch'));
    expect(e.message).toBe('Failed to fetch');
  });
});
