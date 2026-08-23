import { describe, it, expect } from 'vitest';
import { appendableTemplateExercises, parseAccumulatedToolCalls } from '@/contexts/ChatContext';

const ex = (exerciseId: string) => ({ exerciseId, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 120 });

describe('appendableTemplateExercises', () => {
  it('keeps every genuinely new exercise, in the order given', () => {
    const { additions, skipped } = appendableTemplateExercises(
      [ex('barbell-squat')],
      [ex('leg-extension'), ex('plank'), ex('calf-raise')],
    );
    expect(additions.map(e => e.exerciseId)).toEqual(['leg-extension', 'plank', 'calf-raise']);
    expect(skipped).toBe(0);
  });

  it('drops exercises the template already has', () => {
    const { additions, skipped } = appendableTemplateExercises(
      [ex('barbell-squat'), ex('plank')],
      [ex('plank'), ex('leg-extension')],
    );
    expect(additions.map(e => e.exerciseId)).toEqual(['leg-extension']);
    expect(skipped).toBe(1);
  });

  it('drops a repeat inside the incoming batch too', () => {
    const { additions, skipped } = appendableTemplateExercises(
      [],
      [ex('plank'), ex('plank')],
    );
    expect(additions).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it('contributes nothing when the model re-sends the whole existing template', () => {
    const existing = [ex('barbell-squat'), ex('plank')];
    const { additions, skipped } = appendableTemplateExercises(existing, existing);
    expect(additions).toEqual([]);
    expect(skipped).toBe(2);
  });
});

describe('add_exercises_to_template is an allowed action', () => {
  it('survives the client allow-list instead of being silently dropped', () => {
    const { toolCalls, cutOffIds } = parseAccumulatedToolCalls([
      {
        id: 'tc-1',
        name: 'add_exercises_to_template',
        arguments: JSON.stringify({ templateId: 't1', exercises: [ex('plank')] }),
      },
    ]);
    expect(cutOffIds.size).toBe(0);
    expect(toolCalls).toHaveLength(1);
    const call = toolCalls[0];
    expect(call.name).toBe('add_exercises_to_template');
    if (call.name === 'add_exercises_to_template') {
      expect(call.arguments.templateId).toBe('t1');
      expect(call.arguments.exercises).toHaveLength(1);
    }
  });
});
