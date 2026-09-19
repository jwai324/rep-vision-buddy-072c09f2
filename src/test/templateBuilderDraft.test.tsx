import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TemplateBuilder } from '@/components/TemplateBuilder';
import type { WorkoutTemplate } from '@/types/workout';

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
const DRAFT_KEY = 'template_builder_draft';

const push: WorkoutTemplate = {
  id: 'tpl-push',
  name: 'Push Day',
  exercises: [
    { exerciseId: BENCH, sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90, targetWeight: 60 },
    { exerciseId: FLY, sets: 3, targetReps: 12, setType: 'normal', restSeconds: 60 },
  ],
};

/** The same template after an edit made somewhere else: bench dropped to 8 reps. */
const pushEditedElsewhere: WorkoutTemplate = {
  ...push,
  exercises: [{ ...push.exercises[0], targetReps: 8 }, push.exercises[1]],
};

const renderBuilder = (initial?: WorkoutTemplate) =>
  render(<TemplateBuilder initial={initial} onSave={vi.fn()} onCancel={vi.fn()} />);

const nameBox = () => screen.getByPlaceholderText('Template name...') as HTMLInputElement;
/** The reps cells, one per exercise, top to bottom. They are the only numeric inputs bound to reps. */
const repsCells = () => screen.getAllByPlaceholderText(/^(Fail|—)$/)
  .filter(el => (el as HTMLInputElement).inputMode === 'numeric') as HTMLInputElement[];
const storedDraft = () => JSON.parse(localStorage.getItem(DRAFT_KEY)!);

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe('the template builder draft is restored only over the template it was taken from', () => {
  it('comes back after a reload when the template is unchanged, stamped with its source', () => {
    const { unmount } = renderBuilder(push);
    fireEvent.change(nameBox(), { target: { value: 'Push Day (wip)' } });
    expect(storedDraft().source).toMatch(/^[0-9a-f]{8}$/);
    unmount();

    const second = renderBuilder(push);
    expect(nameBox()).toHaveValue('Push Day (wip)');
    // Content, not identity: the same rows read back from the server are the same source.
    second.unmount();
    renderBuilder({ ...push, exercises: push.exercises.map(e => ({ ...e })), updatedAt: '2026-09-19T00:00:00Z' });
    expect(nameBox()).toHaveValue('Push Day (wip)');
  });

  it('is dropped when the template changed since, so the newer version is what opens', () => {
    const { unmount } = renderBuilder(push);
    fireEvent.change(nameBox(), { target: { value: 'Push Day (wip)' } });
    const staleSource = storedDraft().source;
    unmount();

    // Another device, the coach or an import saved bench at 8 reps in between.
    renderBuilder(pushEditedElsewhere);
    expect(nameBox()).toHaveValue('Push Day');
    expect(repsCells()[0]).toHaveValue(8);
    // The stale draft is gone from storage too, replaced by one of the current rows.
    expect(storedDraft().name).toBe('Push Day');
    expect(storedDraft().source).not.toBe(staleSource);
  });

  it('is kept for a new template, which has nothing to conflict with', () => {
    const { unmount } = renderBuilder();
    fireEvent.change(nameBox(), { target: { value: 'Legs' } });
    expect(storedDraft()).toMatchObject({ id: null, source: null });
    unmount();

    renderBuilder();
    expect(nameBox()).toHaveValue('Legs');
  });

  it('drops a draft written before the source was recorded, which cannot be checked', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: push.id, name: 'Stale', blocks: [] }));

    renderBuilder(push);
    expect(nameBox()).toHaveValue('Push Day');
    expect(repsCells()).toHaveLength(2);
  });

  it('still ignores a draft for a different template', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: 'tpl-other', name: 'Other', blocks: [], source: null }));

    renderBuilder(push);
    expect(nameBox()).toHaveValue('Push Day');
  });
});
