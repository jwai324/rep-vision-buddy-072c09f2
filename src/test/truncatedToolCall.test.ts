import { describe, it, expect } from 'vitest';
import { parseAccumulatedToolCalls } from '@/contexts/ChatContext';

const raw = (id: string, name: string, args: string) => ({ id, name, arguments: args });

const completeTemplateArgs = JSON.stringify({
  name: 'Wednesday Iso revised',
  exercises: [{ exerciseId: 'leg-extension', sets: 3, targetReps: 12, setType: 'normal', restSeconds: 90 }],
});

describe('parseAccumulatedToolCalls', () => {
  it('parses a complete tool call and flags nothing as cut off', () => {
    const { toolCalls, cutOffIds } = parseAccumulatedToolCalls([
      raw('tc-1', 'create_template', completeTemplateArgs),
    ]);
    expect(cutOffIds.size).toBe(0);
    expect(toolCalls).toHaveLength(1);
    const call = toolCalls[0];
    expect(call.name).toBe('create_template');
    if (call.name === 'create_template') {
      expect(call.arguments.name).toBe('Wednesday Iso revised');
      expect(call.arguments.exercises).toHaveLength(1);
    }
  });

  it('flags a call whose argument JSON was cut off mid-stream', () => {
    // What the client is left holding when the response hits max_tokens
    // partway through the tool_use block.
    const truncated = completeTemplateArgs.slice(0, completeTemplateArgs.length - 30);
    const { toolCalls, cutOffIds } = parseAccumulatedToolCalls([
      raw('tc-1', 'create_template', truncated),
    ]);
    expect(cutOffIds.has('tc-1')).toBe(true);
    expect(toolCalls).toHaveLength(1);
  });

  it('flags only the cut-off call when an earlier one completed', () => {
    const { toolCalls, cutOffIds } = parseAccumulatedToolCalls([
      raw('tc-1', 'delete_template', JSON.stringify({ templateId: 't1' })),
      raw('tc-2', 'create_template', '{"name":"Half written","exer'),
    ]);
    expect(toolCalls).toHaveLength(2);
    expect([...cutOffIds]).toEqual(['tc-2']);
  });

  it('drops calls that are not allowed actions or never got a name', () => {
    const { toolCalls } = parseAccumulatedToolCalls([
      undefined,
      raw('tc-1', '', '{}'),
      raw('tc-2', 'drop_database', '{}'),
      raw('tc-3', 'delete_template', JSON.stringify({ templateId: 't1' })),
    ]);
    expect(toolCalls.map(tc => tc.id)).toEqual(['tc-3']);
  });
});
