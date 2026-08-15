import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseDetailModal } from '@/components/ExerciseDetailModal';
import type { WorkoutSession } from '@/types/workout';

const CUSTOM_ID = 'custom-abc-123';

const customExercise = {
  id: CUSTOM_ID,
  name: 'Sled Push',
  primaryBodyPart: 'Legs',
  equipment: 'Machine',
  difficulty: 'Intermediate' as const,
  exerciseType: 'Compound' as const,
  movementPattern: 'Push',
  secondaryMuscles: ['Glutes'],
  isCustom: true as const,
  isRecovery: false,
};

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: [customExercise],
    loading: false,
    addExercise: vi.fn(),
    deleteExercise: vi.fn(),
    updateExercise: vi.fn(),
  }),
}));

function session(over: Partial<WorkoutSession> & { exerciseId: string; note?: string }): WorkoutSession {
  const { exerciseId, note, ...rest } = over;
  return {
    id: `s-${exerciseId}-${rest.date}`,
    date: '2026-08-10',
    exercises: [{
      exerciseId,
      exerciseName: 'x',
      note,
      sets: [{ setNumber: 1, type: 'normal', reps: 10, weight: 60 }],
    }],
    duration: 1800,
    totalVolume: 600,
    totalSets: 1,
    totalReps: 10,
    ...rest,
  };
}

// Radix tab triggers switch on mouseDown/focus, not on a synthetic click.
const openTab = (name: RegExp) => fireEvent.mouseDown(screen.getByRole('tab', { name }));
const openNotesTab = () => openTab(/notes/i);

describe('ExerciseDetailModal — custom exercises get a card', () => {
  it('renders a card for a custom exercise instead of nothing', () => {
    render(<ExerciseDetailModal exerciseId={CUSTOM_ID} onClose={vi.fn()} history={[]} />);

    expect(screen.getByText('Sled Push')).toBeInTheDocument();
    expect(screen.getByText(/custom/i)).toBeInTheDocument();
  });

  it('still renders built-in exercises, unmarked', () => {
    render(<ExerciseDetailModal exerciseId="flat-barbell-bench-press" onClose={vi.fn()} history={[]} />);

    expect(screen.getByText('Flat Barbell Bench Press')).toBeInTheDocument();
    expect(screen.queryByText(/^custom$/i)).not.toBeInTheDocument();
  });

  it('renders nothing for an id that matches no exercise', () => {
    const { container } = render(
      <ExerciseDetailModal exerciseId="not-a-real-exercise" onClose={vi.fn()} history={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the custom exercise history, which is keyed off the same id', () => {
    render(
      <ExerciseDetailModal
        exerciseId={CUSTOM_ID}
        onClose={vi.fn()}
        history={[session({ exerciseId: CUSTOM_ID, date: '2026-08-10' })]}
      />,
    );

    openTab(/history/i);
    expect(screen.getByText(/Set 1/)).toBeInTheDocument();
  });
});

describe('ExerciseDetailModal — Notes tab', () => {
  let onUpdateStickyNotes: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onUpdateStickyNotes = vi.fn().mockResolvedValue(undefined);
  });

  it('loads the existing sticky note into the editor', () => {
    render(
      <ExerciseDetailModal
        exerciseId={CUSTOM_ID}
        onClose={vi.fn()}
        history={[]}
        stickyNotes={{ [CUSTOM_ID]: 'Chest up, drive through the toes' }}
        onUpdateStickyNotes={onUpdateStickyNotes}
      />,
    );

    openNotesTab();
    expect(screen.getByRole('textbox')).toHaveValue('Chest up, drive through the toes');
  });

  it('saves an edited sticky note under the exercise id, keeping other notes', () => {
    render(
      <ExerciseDetailModal
        exerciseId={CUSTOM_ID}
        onClose={vi.fn()}
        history={[]}
        stickyNotes={{ 'squat': 'belt on', [CUSTOM_ID]: 'old cue' }}
        onUpdateStickyNotes={onUpdateStickyNotes}
      />,
    );

    openNotesTab();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'new cue' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    expect(onUpdateStickyNotes).toHaveBeenCalledWith({
      stickyNotes: { squat: 'belt on', [CUSTOM_ID]: 'new cue' },
    });
  });

  it('keeps Save disabled until the note actually changes', () => {
    render(
      <ExerciseDetailModal
        exerciseId={CUSTOM_ID}
        onClose={vi.fn()}
        history={[]}
        stickyNotes={{ [CUSTOM_ID]: 'unchanged' }}
        onUpdateStickyNotes={onUpdateStickyNotes}
      />,
    );

    openNotesTab();
    const save = screen.getByRole('button', { name: /save note/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited' } });
    expect(save).not.toBeDisabled();
  });

  it('lists notes written during past workouts, newest first', () => {
    render(
      <ExerciseDetailModal
        exerciseId={CUSTOM_ID}
        onClose={vi.fn()}
        history={[
          session({ exerciseId: CUSTOM_ID, date: '2026-08-12', note: 'felt heavy' }),
          session({ exerciseId: CUSTOM_ID, date: '2026-08-05', note: 'added a plate' }),
          session({ exerciseId: CUSTOM_ID, date: '2026-08-01' }),
        ]}
        onUpdateStickyNotes={onUpdateStickyNotes}
      />,
    );

    openNotesTab();
    const notes = screen.getAllByText(/felt heavy|added a plate/);
    expect(notes.map(n => n.textContent)).toEqual(['felt heavy', 'added a plate']);
  });

  it('does not pull in notes from a different exercise', () => {
    render(
      <ExerciseDetailModal
        exerciseId={CUSTOM_ID}
        onClose={vi.fn()}
        history={[session({ exerciseId: 'squat', date: '2026-08-12', note: 'someone else note' })]}
        onUpdateStickyNotes={onUpdateStickyNotes}
      />,
    );

    openNotesTab();
    expect(screen.queryByText('someone else note')).not.toBeInTheDocument();
    expect(screen.getByText(/no session notes for this exercise yet/i)).toBeInTheDocument();
  });

  it('falls back to a read-only note when no save handler is wired up', () => {
    render(
      <ExerciseDetailModal
        exerciseId={CUSTOM_ID}
        onClose={vi.fn()}
        history={[]}
        stickyNotes={{ [CUSTOM_ID]: 'read me' }}
      />,
    );

    openNotesTab();
    expect(screen.getByText('read me')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('swaps the draft when the modal is reused for another exercise', () => {
    const { rerender } = render(
      <ExerciseDetailModal
        exerciseId={CUSTOM_ID}
        onClose={vi.fn()}
        history={[]}
        stickyNotes={{ [CUSTOM_ID]: 'sled cue', 'flat-barbell-bench-press': 'bench cue' }}
        onUpdateStickyNotes={onUpdateStickyNotes}
      />,
    );

    openNotesTab();
    expect(screen.getByRole('textbox')).toHaveValue('sled cue');

    rerender(
      <ExerciseDetailModal
        exerciseId="flat-barbell-bench-press"
        onClose={vi.fn()}
        history={[]}
        stickyNotes={{ [CUSTOM_ID]: 'sled cue', 'flat-barbell-bench-press': 'bench cue' }}
        onUpdateStickyNotes={onUpdateStickyNotes}
      />,
    );

    openNotesTab();
    expect(screen.getByRole('textbox')).toHaveValue('bench cue');
  });
});
