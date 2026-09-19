import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FocusMode } from '@/components/FocusMode';
import type { ExerciseBlock } from '@/types/activeSession';
import type { ExerciseInputMode } from '@/utils/exerciseInputMode';

const BENCH = 'flat-barbell-bench-press';
const BAND = 'band-pull-apart';

function block(exerciseId: string, name: string, weight: string): ExerciseBlock {
  return {
    exerciseId: exerciseId as ExerciseBlock['exerciseId'],
    exerciseName: name,
    restSeconds: 60,
    sets: [{ setNumber: 1, weight, reps: '12', rpe: '', time: '', completed: false, type: 'normal' }],
  };
}

const renderFocus = (blocks: ExerciseBlock[], modes: Record<string, ExerciseInputMode>) => render(
  <FocusMode
    blocks={blocks}
    weightUnit="lbs"
    activeTimer={null}
    restRecords={{}}
    runningSet={null}
    getStickyNote={() => ''}
    getPrevious={() => ({ date: null, sets: [] })}
    getInputMode={id => modes[id] ?? 'reps-weight'}
    onUpdateSet={vi.fn()}
    onToggleComplete={vi.fn()}
    onAddSet={vi.fn()}
    onAddDrop={vi.fn()}
    onUpdateDrop={vi.fn()}
    onRemoveSet={vi.fn()}
    onRemoveDrop={vi.fn()}
    onMenuAction={vi.fn()}
    onStartTimer={vi.fn()}
    onSkipTimer={vi.fn()}
    onExtendTimer={vi.fn()}
    onStartNextSet={vi.fn()}
    onStopSet={vi.fn()}
    onClose={vi.fn()}
  />,
);

describe('Focus Mode "Up next"', () => {
  it("shows a band exercise's level as its label, not as a weight", () => {
    renderFocus(
      [block(BENCH, 'Bench', '135'), block(BAND, 'Band Pull-Apart', '3')],
      { [BAND]: 'band' },
    );
    expect(screen.getByText(/Medium/)).toBeInTheDocument();
    expect(screen.queryByText(/3lbs/)).toBeNull();
  });

  it('still shows a loaded exercise as weight and unit', () => {
    renderFocus(
      [block(BAND, 'Band Pull-Apart', '3'), block(BENCH, 'Bench', '135')],
      { [BAND]: 'band' },
    );
    expect(screen.getByText(/135lbs/)).toBeInTheDocument();
  });
});
