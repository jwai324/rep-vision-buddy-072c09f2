import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseSelector } from '@/components/ExerciseSelector';

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('Body-part filter chips overflow', () => {
  it('renders chips in a single horizontally-scrollable row with hidden scrollbar', () => {
    render(
      <ExerciseSelector
        onSelect={vi.fn()}
        multiSelect={false}
      />,
    );

    const chips = screen.getByTestId('body-part-chips');
    expect(chips.className).toMatch(/overflow-x-auto/);
    expect(chips.className).toMatch(/scrollbar-hide/);
    expect(chips.className).toMatch(/flex-nowrap/);
    // Must NOT use flex-wrap (which would line-break instead of scrolling)
    expect(chips.className).not.toMatch(/flex-wrap/);
  });

  it('each chip is shrink-0 so it keeps its width inside the scroll container', () => {
    render(
      <ExerciseSelector
        onSelect={vi.fn()}
        multiSelect={false}
      />,
    );

    const chips = screen.getByTestId('body-part-chips');
    const chipButtons = chips.querySelectorAll('button');
    expect(chipButtons.length).toBeGreaterThan(5);
    for (const btn of Array.from(chipButtons)) {
      expect(btn.className).toMatch(/shrink-0/);
    }
  });
});
