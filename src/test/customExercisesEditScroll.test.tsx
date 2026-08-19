import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomExercisesScreen } from '@/components/CustomExercisesScreen';
import type { CustomExercise } from '@/hooks/useCustomExercises';

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mkExercise = (id: string, name: string): CustomExercise => ({
  id,
  name,
  primaryBodyPart: 'Chest',
  equipment: 'Barbell',
  difficulty: 'Intermediate',
  exerciseType: 'Compound',
  movementPattern: 'Push',
  secondaryMuscles: [],
  isCustom: true,
  isRecovery: false,
  excludeFromVolume: false,
});

const exercises = [mkExercise('custom-1', 'Bench Press'), mkExercise('custom-2', 'Sled Push')];

const renderScreen = () =>
  render(
    <CustomExercisesScreen
      exercises={exercises}
      onAdd={vi.fn()}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      onBack={vi.fn()}
    />,
  );

let scrollIntoView: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
});
afterEach(() => {
  scrollIntoView.mockRestore();
});

describe('editing a custom exercise', () => {
  it('scrolls the editor into view, since it opens above the list', () => {
    renderScreen();
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Edit Sled Push'));

    expect(screen.getByText('Edit Exercise')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByTestId('custom-exercise-form'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('scrolls again when a second exercise is edited while the form is open', () => {
    renderScreen();

    fireEvent.click(screen.getByLabelText('Edit Sled Push'));
    fireEvent.click(screen.getByLabelText('Edit Bench Press'));

    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    // The form is showing the exercise that was tapped second.
    expect(screen.getByDisplayValue('Bench Press')).toBeInTheDocument();
  });

  it('scrolls to the form when a new exercise is created too', () => {
    renderScreen();

    fireEvent.click(screen.getByRole('button', { name: /create exercise/i }));

    expect(screen.getByText('New Exercise')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does not scroll once the editor is closed', () => {
    renderScreen();

    fireEvent.click(screen.getByLabelText('Edit Sled Push'));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByTestId('custom-exercise-form')).not.toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
