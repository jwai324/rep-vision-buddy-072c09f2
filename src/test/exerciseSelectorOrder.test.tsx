import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExerciseSelector } from '@/components/ExerciseSelector';
import { EXERCISE_DATABASE } from '@/data/exercises';
import { searchExercises } from '@/utils/exerciseSearch';

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const renderedNames = () => {
  const list = screen.getByTestId('exercise-results');
  return Array.from(list.querySelectorAll('button')).map(
    btn => btn.querySelector('span')?.textContent ?? '',
  );
};

const search = async (query: string) => {
  render(<ExerciseSelector onSelect={vi.fn()} multiSelect={false} />);
  fireEvent.change(screen.getByPlaceholderText('Search exercises...'), {
    target: { value: query },
  });
  await waitFor(() => expect(screen.getByTestId('exercise-results')).toBeInTheDocument(), {
    timeout: 3000,
  });
};

describe('ExerciseSelector result order', () => {
  it('renders search results in the order the search ranked them', async () => {
    await search('curl');
    const expected = searchExercises(EXERCISE_DATABASE, 'curl').map(e => e.name);
    await waitFor(() => expect(renderedNames()).toHaveLength(expected.length), { timeout: 3000 });
    expect(renderedNames()).toEqual(expected);
  });

  it('does not alphabetise the results', async () => {
    await search('curl');
    const expected = searchExercises(EXERCISE_DATABASE, 'curl').map(e => e.name);
    await waitFor(() => expect(renderedNames()).toHaveLength(expected.length), { timeout: 3000 });
    const alphabetical = [...expected].sort((a, b) => a.localeCompare(b));
    expect(expected).not.toEqual(alphabetical); // guards the assertion below
    expect(renderedNames()).not.toEqual(alphabetical);
  });

  it('puts an exact name match first on screen', async () => {
    await search('hammer curl');
    await waitFor(() => expect(renderedNames().length).toBeGreaterThan(1), { timeout: 3000 });
    expect(renderedNames()[0]).toBe('Hammer Curl');
  });

  it('keeps no Full Body cardio rows in a "curl" search', async () => {
    await search('curl');
    await waitFor(() => expect(renderedNames().length).toBeGreaterThan(0), { timeout: 3000 });
    expect(renderedNames()).not.toContain('Assault Bike');
  });

  it('browsing with no query keeps the alphabetical body-part groups', () => {
    render(<ExerciseSelector onSelect={vi.fn()} multiSelect={false} />);
    expect(screen.queryByTestId('exercise-results')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /chest/i })).toBeInTheDocument();
  });

  // The library ships two rows sharing the id `medicine-ball-chest-pass`. The
  // grouped view puts them under different body parts, but the ranked search
  // list is flat, so keying it by id made them siblings with the same key —
  // React warns and may drop one, and the warning is swept into every bug
  // report filed afterwards by the console-error buffer.
  it('renders both rows of a duplicated exercise id without a React key clash', async () => {
    const keyErrors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      keyErrors.push(args.map(String).join(' '));
    });
    try {
      await search('chest pass');
      await waitFor(() => expect(renderedNames().length).toBeGreaterThan(0), { timeout: 3000 });

      const expected = searchExercises(EXERCISE_DATABASE, 'chest pass');
      expect(expected.filter(e => e.id === 'medicine-ball-chest-pass')).toHaveLength(2);
      expect(renderedNames()).toEqual(expected.map(e => e.name));
    } finally {
      spy.mockRestore();
    }
    expect(keyErrors.filter(e => /same key/i.test(e))).toEqual([]);
  });
});
