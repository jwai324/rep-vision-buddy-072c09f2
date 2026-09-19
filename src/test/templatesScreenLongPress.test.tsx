import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TemplatesScreen } from '@/components/TemplatesScreen';
import type { WorkoutTemplate } from '@/types/workout';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [], loading: false,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

const template: WorkoutTemplate = {
  id: 'tpl-1',
  name: 'Push',
  exercises: [{ exerciseId: 'flat-barbell-bench-press', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }],
};

const renderScreen = () => render(
  <TemplatesScreen
    templates={[template]} onDelete={vi.fn()}
    onStart={vi.fn()} onEdit={vi.fn()} onDuplicate={vi.fn()} onShare={vi.fn()} onCreate={vi.fn()} onBack={vi.fn()}
  />,
);

const card = () => screen.getByText('Push').parentElement as HTMLElement;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the templates list long press', () => {
  it('opens the menu after a held touch', () => {
    renderScreen();
    fireEvent.touchStart(card(), { touches: [{ clientX: 10, clientY: 100 }] });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Duplicate Template')).toBeInTheDocument();
  });

  it('is cancelled by a scroll, which moves the finger before it lifts', () => {
    renderScreen();
    fireEvent.touchStart(card(), { touches: [{ clientX: 10, clientY: 100 }] });
    fireEvent.touchMove(card(), { touches: [{ clientX: 10, clientY: 160 }] });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText('Duplicate Template')).toBeNull();
  });

  it('survives the slight drift of a real finger', () => {
    renderScreen();
    fireEvent.touchStart(card(), { touches: [{ clientX: 10, clientY: 100 }] });
    fireEvent.touchMove(card(), { touches: [{ clientX: 12, clientY: 103 }] });
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('Duplicate Template')).toBeInTheDocument();
  });
});
