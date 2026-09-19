import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { ProgramBuilder } from '@/components/ProgramBuilder';
import type { WorkoutProgram, WorkoutSession, WorkoutTemplate } from '@/types/workout';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock('@/contexts/CustomExercisesContext', () => {
  const exercises: never[] = [];
  return {
    useCustomExercisesContext: () => ({
      exercises, loading: false,
      addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
    }),
  };
});

const BENCH = 'flat-barbell-bench-press';
const FLY = 'dumbbell-fly';
const ROW = 'barbell-bent-over-row';

const push: WorkoutTemplate = {
  id: 'tpl-push',
  name: 'Push Day',
  exercises: [
    { exerciseId: BENCH, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90, targetWeight: 60 },
    { exerciseId: FLY, sets: 3, targetReps: 12, setType: 'normal', restSeconds: 60 },
  ],
};

const pull: WorkoutTemplate = {
  id: 'tpl-pull',
  name: 'Pull Day',
  exercises: [
    { exerciseId: ROW, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 },
  ],
};

const pastSession: WorkoutSession = {
  id: 'sess-1',
  date: '2026-09-01',
  exercises: [{ exerciseId: BENCH, exerciseName: 'Flat Barbell Bench Press', sets: [] }],
  duration: 0, totalVolume: 0, totalSets: 0, totalReps: 0,
};

const program: WorkoutProgram = {
  id: 'prog-1',
  name: 'Push/Pull',
  durationWeeks: 8,
  days: [
    { label: 'Chest', templateId: 'tpl-push', frequency: { type: 'weekly', weekday: 1 } },
    { label: 'Rest', templateId: 'rest' },
    { label: 'Back', templateId: 'tpl-pull' },
    { label: 'Redo', templateId: `session:${pastSession.id}` },
  ],
};

type Props = React.ComponentProps<typeof ProgramBuilder>;

function renderBuilder(over: Partial<Props> = {}) {
  const props: Props = {
    templates: [push, pull],
    history: [pastSession],
    initial: program,
    weightUnit: 'kg',
    onSave: vi.fn(),
    onSaveTemplate: vi.fn().mockResolvedValue(true),
    onCancel: vi.fn(),
    ...over,
  };
  return { ...render(<ProgramBuilder {...props} />), props };
}

/** The tile for day N, found from its heading. */
const tile = (n: number) => screen.getByText(`Day ${n}`).closest('[data-testid="program-day"]') as HTMLElement;
/** The footer strip that opens a tile's template; null on a day that has none. */
const footer = (n: number) => tile(n).querySelector('button[aria-expanded]') as HTMLButtonElement | null;
/** A tile's reps cells, one per exercise, top to bottom. They are the only numeric inputs bound to reps. */
const repsCells = (t: HTMLElement) => within(t).getAllByPlaceholderText(/^(Fail|—)$/)
  .filter(el => (el as HTMLInputElement).inputMode === 'numeric') as HTMLInputElement[];

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('ProgramBuilder tiles', () => {
  it('lays each day out as a tile with its fields, and a template footer only where there is a template', () => {
    renderBuilder();

    expect(screen.getByRole('heading', { name: 'Edit Program' })).toBeInTheDocument();
    expect(screen.getByText('4 days — 3 training, 1 rest · 8 weeks')).toBeInTheDocument();

    expect(screen.getByLabelText('Label for day 1')).toHaveValue('Chest');
    expect(screen.getByLabelText('Workout for day 1')).toHaveValue('tpl-push');
    expect(screen.getByLabelText('Frequency for day 1')).toHaveValue('weekly');
    expect(screen.getByLabelText('Workout for day 2')).toHaveValue('rest');
    expect(screen.getByLabelText('Workout for day 4')).toHaveValue('session:sess-1');

    expect(footer(1)).toHaveTextContent('Push Day · 2 exercises');
    expect(footer(2)).toBeNull();
    expect(footer(3)).toHaveTextContent('Pull Day · 1 exercise');
    expect(footer(4)).toBeNull();

    // Collapsed: the exercises are not on screen.
    expect(screen.queryByText('Flat Barbell Bench Press')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show Calendar Preview' })).toBeInTheDocument();
  });

  it('shows the weekday buttons only for a day scheduled weekly', () => {
    renderBuilder();

    expect(within(tile(1)).getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(tile(3)).queryByRole('button', { name: 'Mon' })).toBeNull();

    fireEvent.change(screen.getByLabelText('Frequency for day 3'), { target: { value: 'weekly' } });
    expect(within(tile(3)).getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(tile(3)).getByRole('button', { name: 'Wed' }));
    expect(within(tile(3)).getByRole('button', { name: 'Wed' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(tile(3)).getByRole('button', { name: 'Mon' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.change(screen.getByLabelText('Frequency for day 3'), { target: { value: 'monthly' } });
    expect(within(tile(3)).queryByRole('button', { name: 'Mon' })).toBeNull();
    expect(within(tile(3)).getByText('of each month')).toBeInTheDocument();
  });

  it('opens several tiles at once and shows each template for editing', () => {
    renderBuilder();

    fireEvent.click(footer(1)!);
    fireEvent.click(footer(3)!);

    expect(footer(1)).toHaveAttribute('aria-expanded', 'true');
    expect(footer(3)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Flat Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Dumbbell Fly')).toBeInTheDocument();
    expect(screen.getByText('Barbell Bent-Over Row')).toBeInTheDocument();
    expect(screen.getAllByText('Changes apply everywhere this template is used.')).toHaveLength(2);
    // The saved target is what the cells start from: one row per exercise,
    // with the set count next to it rather than a row per set.
    expect(repsCells(tile(1))).toHaveLength(2);
    expect(repsCells(tile(1))[0]).toHaveValue(10);
    expect(within(tile(1)).getAllByTestId('set-count').map(n => n.textContent)).toEqual(['3 sets', '3 sets']);

    fireEvent.click(footer(1)!);
    expect(screen.queryByText('Flat Barbell Bench Press')).toBeNull();
    expect(screen.getByText('Barbell Bent-Over Row')).toBeInTheDocument();
  });

  it('keeps the tiles below a removed day open', () => {
    renderBuilder();

    fireEvent.click(footer(3)!);
    fireEvent.click(screen.getByRole('button', { name: 'Remove day 1' }));

    expect(screen.queryByText('Day 4')).toBeNull();
    expect(screen.getByLabelText('Workout for day 2')).toHaveValue('tpl-pull');
    expect(footer(2)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Barbell Bent-Over Row')).toBeInTheDocument();
  });
});

describe('editing a template inside its tile', () => {
  it('saves from the tile and clears the unsaved mark', async () => {
    const { props, rerender } = renderBuilder();

    fireEvent.click(footer(1)!);
    const save = within(tile(1)).getByRole('button', { name: 'Save template' });
    expect(save).toBeDisabled();
    expect(within(tile(1)).queryByText('Unsaved changes')).toBeNull();

    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });
    expect(within(tile(1)).getByText('Unsaved changes')).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.click(save);
    await waitFor(() => expect(props.onSaveTemplate).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(props.onSaveTemplate).mock.calls[0][0];
    expect(saved.id).toBe('tpl-push');
    expect(saved.name).toBe('Push Day');
    expect(saved.exercises[0]).toMatchObject({ exerciseId: BENCH, sets: 3, targetReps: 8, targetWeight: 60, restSeconds: 90 });
    expect(saved.exercises[1]).toMatchObject({ exerciseId: FLY, sets: 3, targetReps: 12 });

    await waitFor(() => expect(within(tile(1)).queryByText('Unsaved changes')).toBeNull());
    expect(toast.success).toHaveBeenCalledWith('Template "Push Day" saved.');

    // The store hands the saved template back; the tile now reads from it.
    rerender(<ProgramBuilder {...props} templates={[saved, pull]} />);
    expect(repsCells(tile(1))[0]).toHaveValue(8);
    expect(within(tile(1)).getByRole('button', { name: 'Save template' })).toBeDisabled();
  });

  it('saves a set count changed from the tile, with the row typed once behind every set', async () => {
    const { props } = renderBuilder();

    fireEvent.click(footer(1)!);
    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Add a set to Flat Barbell Bench Press' }));
    expect(within(tile(1)).getAllByTestId('set-count')[0]).toHaveTextContent('4 sets');
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Remove a set from Dumbbell Fly' }));
    expect(within(tile(1)).getAllByTestId('set-count')[1]).toHaveTextContent('2 sets');

    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(props.onSaveTemplate).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(props.onSaveTemplate).mock.calls[0][0];
    expect(saved.exercises[0]).toMatchObject({ exerciseId: BENCH, sets: 4, targetReps: 8, targetWeight: 60 });
    expect(saved.exercises[1]).toMatchObject({ exerciseId: FLY, sets: 2, targetReps: 12 });
  });

  it('discards an unsaved edit and puts the saved template back', () => {
    const { props } = renderBuilder();

    fireEvent.click(footer(1)!);
    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });
    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Discard' }));

    expect(repsCells(tile(1))[0]).toHaveValue(10);
    expect(within(tile(1)).queryByText('Unsaved changes')).toBeNull();
    expect(props.onSaveTemplate).not.toHaveBeenCalled();
  });

  it('shows one edit in every tile that uses the template', () => {
    renderBuilder({
      initial: {
        ...program,
        days: [
          { label: 'A', templateId: 'tpl-push' },
          { label: 'B', templateId: 'tpl-push' },
        ],
      },
    });

    fireEvent.click(footer(1)!);
    fireEvent.click(footer(2)!);
    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });

    expect(repsCells(tile(2))[0]).toHaveValue(8);
    expect(within(tile(1)).getByText('Unsaved changes')).toBeInTheDocument();
    expect(within(tile(2)).getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('refuses to save the program while a template edit is unsaved', async () => {
    const { props } = renderBuilder();

    fireEvent.click(footer(1)!);
    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Program' }));

    expect(props.onSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Push Day'));

    fireEvent.click(within(tile(1)).getByRole('button', { name: 'Save template' }));
    await waitFor(() => expect(within(tile(1)).queryByText('Unsaved changes')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Save Program' }));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onSave).mock.calls[0][0]).toMatchObject({
      id: 'prog-1',
      name: 'Push/Pull',
      durationWeeks: 8,
      days: program.days,
    });
  });

  it('keeps an unsaved template edit in the draft across a reload', () => {
    const { unmount } = renderBuilder();

    fireEvent.click(footer(1)!);
    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });
    unmount();

    renderBuilder();
    expect(within(tile(1)).getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(footer(1)!);
    expect(repsCells(tile(1))[0]).toHaveValue(8);
  });

  it('drops the draft, template edits included, when the user backs out', () => {
    const { props } = renderBuilder();

    fireEvent.click(footer(1)!);
    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });
    expect(localStorage.getItem('program_builder_draft')).toContain('tpl-push');

    fireEvent.click(screen.getByRole('button', { name: 'Back to programs' }));

    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('program_builder_draft')).toBeNull();
  });
});

describe('a new program', () => {
  it('uses the same tile layout, with the calendar preview and a save gated on a name', () => {
    const { props } = renderBuilder({ initial: undefined });

    expect(screen.getByRole('heading', { name: 'New Program' })).toBeInTheDocument();
    expect(screen.getByText('Day 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Workout for day 1')).toHaveValue('rest');
    expect(footer(1)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show Calendar Preview' }));
    expect(screen.getByRole('button', { name: 'Hide Calendar Preview' })).toBeInTheDocument();

    const save = screen.getByRole('button', { name: 'Save Program' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Starter' } });
    fireEvent.change(screen.getByLabelText('Workout for day 1'), { target: { value: 'tpl-pull' } });
    expect(footer(1)).toHaveTextContent('Pull Day · 1 exercise');

    fireEvent.click(save);
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onSave).mock.calls[0][0]).toMatchObject({
      name: 'Starter',
      days: [{ label: 'Day 1', templateId: 'tpl-pull' }],
    });
  });
});

describe('saving the program waits for the row', () => {
  const DRAFT_KEY = 'program_builder_draft';

  it('keeps the draft and says nothing on a failed save, so the user can retry', async () => {
    const { props } = renderBuilder({ onSave: vi.fn().mockResolvedValue(false) });
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save Program' }));

    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    // The builder used to clear the draft and toast "saved" before the write
    // resolved, so a failed upsert lost the whole program.
    expect(localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('clears the draft and confirms once the save has landed', async () => {
    renderBuilder({ onSave: vi.fn().mockResolvedValue(true) });

    fireEvent.click(screen.getByRole('button', { name: 'Save Program' }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe('the draft is restored only over the rows it was taken from', () => {
  const DRAFT_KEY = 'program_builder_draft';
  const storedDraft = () => JSON.parse(localStorage.getItem(DRAFT_KEY)!);

  it('comes back after a reload when the program is unchanged', () => {
    const { unmount } = renderBuilder();
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Push/Pull v2' } });
    expect(storedDraft().source).toMatch(/^[0-9a-f]{8}$/);
    unmount();

    renderBuilder();
    expect(screen.getByLabelText('Program name')).toHaveValue('Push/Pull v2');
  });

  it('is dropped when the program changed since, so the newer version is what opens', () => {
    const { unmount } = renderBuilder();
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Push/Pull v2' } });
    unmount();

    // Another device, the coach or an import saved the program at 12 weeks in between.
    renderBuilder({ initial: { ...program, durationWeeks: 12 } });
    expect(screen.getByLabelText('Program name')).toHaveValue('Push/Pull');
    expect(screen.getByLabelText('Duration')).toHaveValue('12');
  });

  it('is kept for a new program, which has nothing to conflict with', () => {
    const { unmount } = renderBuilder({ initial: undefined });
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Starter' } });
    expect(storedDraft()).toMatchObject({ id: null, source: null });
    unmount();

    renderBuilder({ initial: undefined });
    expect(screen.getByLabelText('Program name')).toHaveValue('Starter');
  });

  it('drops a draft written before the source was recorded, which cannot be checked', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      id: program.id, name: 'Stale', durationWeeks: 4, days: program.days, templateDrafts: {},
    }));

    renderBuilder();
    expect(screen.getByLabelText('Program name')).toHaveValue('Push/Pull');
    expect(screen.getByLabelText('Duration')).toHaveValue('8');
  });

  it('drops only the template draft whose template changed elsewhere, and keeps the program draft', () => {
    const { unmount } = renderBuilder();
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'Push/Pull v2' } });
    fireEvent.click(footer(1)!);
    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });
    fireEvent.click(footer(3)!);
    fireEvent.change(repsCells(tile(3))[0], { target: { value: '5' } });
    expect(Object.keys(storedDraft().templateSources).sort()).toEqual(['tpl-pull', 'tpl-push']);
    unmount();

    // Push Day was saved at 6 reps from somewhere else; Pull Day is as it was.
    const pushEditedElsewhere: WorkoutTemplate = {
      ...push,
      exercises: [{ ...push.exercises[0], targetReps: 6 }, push.exercises[1]],
    };
    renderBuilder({ templates: [pushEditedElsewhere, pull] });

    expect(screen.getByLabelText('Program name')).toHaveValue('Push/Pull v2');
    expect(within(tile(1)).queryByText('Unsaved changes')).toBeNull();
    fireEvent.click(footer(1)!);
    expect(repsCells(tile(1))[0]).toHaveValue(6);
    expect(within(tile(3)).getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.click(footer(3)!);
    expect(repsCells(tile(3))[0]).toHaveValue(5);
  });

  it('drops a template draft whose template no longer exists', () => {
    const { unmount } = renderBuilder();
    fireEvent.click(footer(1)!);
    fireEvent.change(repsCells(tile(1))[0], { target: { value: '8' } });
    expect(storedDraft().templateDrafts).toHaveProperty('tpl-push');
    unmount();

    renderBuilder({ templates: [pull] });
    expect(footer(1)).toBeNull();
    expect(storedDraft().templateDrafts).toEqual({});
  });
});
