import { describe, it, expect } from 'vitest';
import {
  requestTooLarge,
  programRequestTooLarge,
  MAX_USER_MESSAGE_CHARS,
  MAX_ASSISTANT_MESSAGE_CHARS,
  MAX_TOOL_RESULT_CHARS,
  MAX_ACTION_RESULTS,
  MAX_CONTEXT_CHARS,
  MAX_REQUEST_CHARS,
  MAX_PROGRAM_EXERCISES,
  MAX_PROGRAM_EXERCISE_CHARS,
  MAX_PROGRAM_INPUT_CHARS,
  MAX_PROGRAM_REQUEST_CHARS,
} from '../../supabase/functions/_shared/requestBounds';
import { EXERCISE_DATABASE } from '../data/exercises';

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

describe('programRequestTooLarge', () => {
  // What AIProgramBuilder sends: the whole built-in library, unfiltered, and
  // every answer at the length the builder allows.
  const library = EXERCISE_DATABASE.map(ex => ({
    name: ex.name,
    primaryBodyPart: ex.primaryBodyPart,
    equipment: ex.equipment,
    exerciseType: ex.exerciseType,
    movementPattern: ex.movementPattern,
  }));
  const inputs = {
    goal: 'Hypertrophy', experience: 'Intermediate (1-3 years)', daysPerWeek: 4, sessionDuration: '60 minutes',
    programDuration: '8 weeks', equipment: ['Full Gym', 'Barbell', 'Dumbbell', 'Cable', 'Machine', 'Bodyweight', 'Band', 'Kettlebell'],
    injuries: chars(300), splitPreference: 'Upper/Lower', additionalNotes: chars(300), custom_notes: chars(300),
  };

  it('lets the real client payload through with room to spare', () => {
    expect(programRequestTooLarge(inputs, library)).toBeNull();
    expect(library.length * 4).toBeLessThan(MAX_PROGRAM_EXERCISES);
    expect(JSON.stringify(library).length * 4).toBeLessThan(MAX_PROGRAM_REQUEST_CHARS);
  });

  it('caps the exercise list by count and by row', () => {
    expect(programRequestTooLarge(inputs, Array.from({ length: MAX_PROGRAM_EXERCISES + 1 }, () => library[0]))).toMatch(/Too many exercises/);
    expect(programRequestTooLarge(inputs, [{ ...library[0], name: chars(MAX_PROGRAM_EXERCISE_CHARS) }])).toMatch(/too long/);
  });

  it('caps every answer, including one sent as an array or object instead of a string', () => {
    expect(programRequestTooLarge({ ...inputs, custom_notes: chars(MAX_PROGRAM_INPUT_CHARS + 1) }, library)).toMatch(/too long/);
    expect(programRequestTooLarge({ ...inputs, custom_notes: chars(MAX_PROGRAM_INPUT_CHARS) }, library)).toBeNull();
    // `${goal}` joins an array, so this would land in the prompt whole.
    expect(programRequestTooLarge({ ...inputs, goal: Array.from({ length: 50 }, () => chars(100)) }, library)).toMatch(/too long/);
  });

  it('bounds the request as a whole, so the per-part ceilings cannot be stacked', () => {
    const rows = Array.from({ length: MAX_PROGRAM_EXERCISES }, () => ({ ...library[0], name: chars(MAX_PROGRAM_EXERCISE_CHARS - 200) }));
    expect(programRequestTooLarge(inputs, rows)).toMatch(/too large/);
    expect(MAX_PROGRAM_REQUEST_CHARS).toBeLessThan(MAX_PROGRAM_EXERCISES * MAX_PROGRAM_EXERCISE_CHARS);
  });

  it('tolerates malformed input rather than throwing before the gate', () => {
    expect(programRequestTooLarge(null, 'nope')).toBeNull();
    expect(programRequestTooLarge('nope', [null, 42, undefined])).toBeNull();
    expect(programRequestTooLarge([chars(10)], [{}])).toBeNull();
  });
});
