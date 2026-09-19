import React, { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateExerciseEditor } from '@/components/TemplateExerciseEditor';
import { ActiveSession } from '@/components/ActiveSession';
import { blockToExercise, templateToBlocks, type TemplateBlock } from '@/utils/templateBlocks';
import type { TemplateExercise } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/TutorialContext', () => ({
  useTutorial: () => ({
    active: false, step: null, start: vi.fn(), next: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(), registerScreen: vi.fn(),
  }),
}));
vi.mock('@/contexts/CustomExercisesContext', () => {
  // No built-in exercise is pure Distance, so the box under test needs a custom one.
  const exercises = [{
    id: 'custom-run', name: 'Trail Run', primaryBodyPart: 'Cardio', equipment: 'None',
    difficulty: 'Beginner', exerciseType: 'Compound', movementPattern: 'Lunge',
    secondaryMuscles: [], measurementType: 'Distance', isRecovery: false, excludeFromVolume: false,
  }];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});

const RUN = 'custom-run';
const customRun = [{ id: RUN, primaryBodyPart: 'Cardio', equipment: 'None', measurementType: 'Distance' as const }];
const runExercise = (over: Partial<TemplateExercise> = {}): TemplateExercise =>
  ({ exerciseId: RUN, sets: 1, targetReps: 'failure', setType: 'normal', restSeconds: 60, ...over });

const kmBox = () => screen.getByPlaceholderText('km') as HTMLInputElement;
const liveDistanceBox = () => document.getElementById('input-0-0-distance') as HTMLInputElement;

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('the template editor distance box', () => {
  it('opens on the saved target and writes what is typed back as a distance, not a load', () => {
    // The box used to be bound to targetWeight, which the save path refuses
    // for distance work, so every save dropped the number and the box was
    // blank on the next open.
    const onBlocks = vi.fn<(blocks: TemplateBlock[]) => void>();
    const initial = templateToBlocks({ id: 'tpl-run', name: 'Run', exercises: [runExercise({ targetDistance: 5000 })] }, 'kg', customRun);
    const Harness = () => {
      const [blocks, setBlocks] = useState(initial);
      useEffect(() => { onBlocks(blocks); }, [blocks]);
      return <TemplateExerciseEditor blocks={blocks} onChange={setBlocks} />;
    };
    render(<Harness />);

    expect(kmBox().value).toBe('5');
    fireEvent.change(kmBox(), { target: { value: '2.5' } });

    const [block] = onBlocks.mock.lastCall![0];
    expect(block.sets[0]).toMatchObject({ targetDistance: '2.5', targetWeight: '' });
    const saved = blockToExercise(block, 'kg', customRun);
    expect(saved.targetDistance).toBe(2500);
    expect(saved.targetWeight).toBeUndefined();
  });
});

describe('a workout started from a template with a distance target', () => {
  it.each([['kg', '5'], ['lbs', '3.11']] as const)('prefills the distance box in the %s user\'s unit, to two decimals', (unit, shown) => {
    render(
      <ActiveSession
        exercises={[RUN]}
        templateExercises={[runExercise({ targetDistance: 5000 })]}
        templateName="Run"
        weightUnit={unit}
        onFinish={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(liveDistanceBox().value).toBe(shown);
  });

  it('leaves the box empty when the template carries no target', () => {
    render(
      <ActiveSession exercises={[RUN]} templateExercises={[runExercise()]} templateName="Run" weightUnit="kg" onFinish={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(liveDistanceBox().value).toBe('');
  });
});
