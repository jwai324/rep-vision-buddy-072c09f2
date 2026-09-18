import { describe, it, expect } from 'vitest';
import {
  requestTooLarge,
  MAX_USER_MESSAGE_CHARS,
  MAX_ASSISTANT_MESSAGE_CHARS,
  MAX_TOOL_RESULT_CHARS,
  MAX_ACTION_RESULTS,
  MAX_CONTEXT_CHARS,
  MAX_REQUEST_CHARS,
} from '../../supabase/functions/_shared/requestBounds';

const user = (content: string) => ({ role: 'user', content });
const assistant = (content: string, args?: string) => ({
  role: 'assistant',
  content,
  ...(args !== undefined
    ? { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'edit_template', arguments: args } }] }
    : {}),
});
const tool = (content: string) => ({ role: 'tool', tool_call_id: 'c1', content });
const chars = (n: number) => 'x'.repeat(n);

describe('requestTooLarge', () => {
  it('lets an ordinary turn through', () => {
    expect(requestTooLarge([user('hi'), assistant('hello'), user('plan my week')], { screen: 'dashboard' }, undefined)).toBeNull();
  });

  it('caps a typed message at the user cap', () => {
    expect(requestTooLarge([user(chars(MAX_USER_MESSAGE_CHARS + 1))], {}, undefined)).toMatch(/too long/);
    expect(requestTooLarge([user(chars(MAX_USER_MESSAGE_CHARS))], {}, undefined)).toBeNull();
  });

  it("measures the coach's own replies against the output budget, not the typed-message cap", () => {
    // A 5,000-character reply sitting in the client's history window used to
    // 413 every following send until it aged out.
    const longReply = assistant(chars(MAX_USER_MESSAGE_CHARS + 1_000));
    expect(requestTooLarge([user('walk me through my program'), longReply, user('thanks')], {}, undefined)).toBeNull();
    expect(requestTooLarge([assistant(chars(MAX_ASSISTANT_MESSAGE_CHARS + 1))], {}, undefined)).toMatch(/too long/);
  });

  it("counts an assistant turn's tool-call arguments, which live outside content", () => {
    const hidden = assistant('', chars(MAX_ASSISTANT_MESSAGE_CHARS + 1));
    expect(requestTooLarge([user('go'), hidden, tool('ok'), user('go')], {}, undefined)).toMatch(/too long/);
  });

  it('caps tool results and action results separately from typed messages', () => {
    expect(requestTooLarge([tool(chars(MAX_USER_MESSAGE_CHARS + 1))], {}, undefined)).toBeNull();
    expect(requestTooLarge([tool(chars(MAX_TOOL_RESULT_CHARS + 1))], {}, undefined)).toMatch(/too long/);
    expect(requestTooLarge([], {}, [{ result: chars(MAX_TOOL_RESULT_CHARS + 1) }])).toMatch(/tool result/);
    expect(requestTooLarge([], {}, Array.from({ length: MAX_ACTION_RESULTS + 1 }, () => ({ ok: true })))).toMatch(/Too many tool results/);
    // One update_set_weight_reps per set: a dozen results is an ordinary edit.
    expect(requestTooLarge([], {}, Array.from({ length: 12 }, () => ({ ok: true })))).toBeNull();
  });

  it('caps the context', () => {
    expect(requestTooLarge([], { blob: chars(MAX_CONTEXT_CHARS) }, undefined)).toMatch(/context/);
  });

  it('bounds the request as a whole, so the per-part ceilings cannot be stacked', () => {
    // Each part is under its own cap; together they are not.
    const msgs = [user('go'), tool(chars(MAX_TOOL_RESULT_CHARS - 10)), user('go'), tool(chars(MAX_TOOL_RESULT_CHARS - 10))];
    const results = [{ r: chars(MAX_TOOL_RESULT_CHARS - 10) }, { r: chars(MAX_TOOL_RESULT_CHARS - 10) }];
    const context = { blob: chars(MAX_CONTEXT_CHARS - 10) };
    expect(requestTooLarge(msgs, context, results)).toMatch(/too large/);
    expect(MAX_REQUEST_CHARS).toBeLessThan(MAX_CONTEXT_CHARS + 4 * MAX_TOOL_RESULT_CHARS);
  });

  it('tolerates malformed input rather than throwing before the gate', () => {
    expect(requestTooLarge('nope', null, 'nope')).toBeNull();
    expect(requestTooLarge([null, 42, { role: 'user' }], undefined, [null])).toBeNull();
  });
});
