import { describe, it, expect, vi, afterEach } from 'vitest';
import { recordUsageAggregate } from '../../supabase/functions/_shared/balance';

// Audit 9.4. recordUsageAggregate used to read today's user_ai_usage row, add
// to it in TypeScript and write it back. Two turns settling at once lost one of
// the two, and the first turn of a day collided on (user_id, date) with the
// error discarded. It now hands the counters to the `record_ai_usage` RPC,
// which increments them in one statement.
//
// There is no Deno runtime here, so the Supabase client is a stub shaped like
// the SupabaseLike contract in balance.ts — the same approach the other
// edge-function tests (requestBounds, creditsTurnCost) take of importing the
// shared module directly.

type RpcResult = { data: unknown; error: { message?: string } | null };

function stubClient(rpcImpl?: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>) {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const fromCalls: string[] = [];
  return {
    rpcCalls,
    fromCalls,
    client: {
      from(table: string) {
        fromCalls.push(table);
        throw new Error(`unexpected table access: ${table}`);
      },
      rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
        rpcCalls.push({ fn, args });
        return rpcImpl ? rpcImpl(fn, args) : Promise.resolve({ data: null, error: null });
      },
    },
  };
}

const USER = '11111111-2222-3333-4444-555555555555';

const usage = {
  input_tokens: 2_000,
  output_tokens: 700,
  cache_creation_input_tokens: 23_000,
  cache_read_input_tokens: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('recordUsageAggregate', () => {
  it('sends one turn to the record_ai_usage RPC with the turn\'s counters', async () => {
    const { client, rpcCalls, fromCalls } = stubClient();

    await recordUsageAggregate(client, USER, usage, 161_250);

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe('record_ai_usage');
    expect(rpcCalls[0].args).toEqual({
      p_user_id: USER,
      p_input_tokens: 2_000,
      p_output_tokens: 700,
      p_cache_creation_tokens: 23_000,
      p_cache_read_tokens: 0,
      p_cost_micros: 161_250,
    });
    // No read-modify-write: the table is never touched directly any more.
    expect(fromCalls).toEqual([]);
  });

  it('counts a turn whose usage fields are missing rather than skipping it', async () => {
    const { client, rpcCalls } = stubClient();

    await recordUsageAggregate(client, USER, {}, 0);

    expect(rpcCalls[0].args).toEqual({
      p_user_id: USER,
      p_input_tokens: 0,
      p_output_tokens: 0,
      p_cache_creation_tokens: 0,
      p_cache_read_tokens: 0,
      p_cost_micros: 0,
    });
  });

  it('clamps nonsense counters instead of sending them to an integer column', async () => {
    const { client, rpcCalls } = stubClient();

    await recordUsageAggregate(
      client,
      USER,
      {
        input_tokens: -5,
        output_tokens: 12.7,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: Number.NaN,
      },
      Number.POSITIVE_INFINITY,
    );

    expect(rpcCalls[0].args).toEqual({
      p_user_id: USER,
      p_input_tokens: 0,
      p_output_tokens: 13,
      p_cache_creation_tokens: 0,
      p_cache_read_tokens: 0,
      p_cost_micros: 0,
    });
  });

  it('logs a returned error and does not throw into the caller', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = stubClient(async () => ({
      data: null,
      error: { message: 'function public.record_ai_usage does not exist' },
    }));

    await expect(recordUsageAggregate(client, USER, usage, 1)).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('record_ai_usage failed');
    expect(String(spy.mock.calls[0][0])).toContain('does not exist');
  });

  it('logs a thrown transport failure and does not throw into the caller', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = stubClient(async () => {
      throw new Error('network down');
    });

    // A coach turn must survive a failure to write the operator's usage report.
    await expect(recordUsageAggregate(client, USER, usage, 1)).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('record_ai_usage threw');
    expect(String(spy.mock.calls[0][0])).toContain('network down');
  });
});
