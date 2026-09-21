import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwipeToDelete } from '@/components/SwipeToDelete';

describe('SwipeToDelete', () => {
  it('settles the row closed when the browser cancels the touch mid-swipe', () => {
    const onDelete = vi.fn();
    render(<SwipeToDelete onDelete={onDelete} removeLabel="Remove set 1"><div>Row</div></SwipeToDelete>);
    const content = screen.getByText('Row').parentElement!;

    fireEvent.touchStart(content, { touches: [{ clientX: 200 }] });
    fireEvent.touchMove(content, { touches: [{ clientX: 100 }] });
    expect(content.style.transform).toBe('translateX(-100px)');

    // A scroll the browser takes over ends the gesture with touchcancel.
    fireEvent.touchCancel(content);
    expect(content.style.transform).toBe('translateX(-0px)');
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('exposes the same delete as a named button, for pointers and keyboards', () => {
    const onDelete = vi.fn();
    render(<SwipeToDelete onDelete={onDelete} removeLabel="Remove set 1"><div>Row</div></SwipeToDelete>);

    fireEvent.click(screen.getByRole('button', { name: 'Remove set 1' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  // Tailwind compiles a bare `group-hover:` to `.group:hover .x` with no
  // `@media (hover: hover)` around it (the project is on 3.4 and does not set
  // `future.hoverOnlyWhenSupported`), and a touch browser applies :hover to
  // the tapped element and its ancestors until the next tap elsewhere. That
  // would arm this button — 28px wide, at the row's left edge — for the thumb
  // of whoever just used the row's own controls. jsdom does not evaluate the
  // stylesheet, so the class list is where the property is guarded.
  it('reveals to a pointer only where hovering is real, and always to the keyboard', () => {
    render(<SwipeToDelete onDelete={vi.fn()} removeLabel="Remove set 1"><div>Row</div></SwipeToDelete>);
    const classes = screen.getByRole('button', { name: 'Remove set 1' }).className.split(/\s+/);

    expect(classes).toContain('[@media(hover:hover)]:group-hover:opacity-100');
    expect(classes).toContain('[@media(hover:hover)]:group-hover:pointer-events-auto');
    expect(classes.filter(c => c.startsWith('group-hover:'))).toEqual([]);

    expect(classes).toContain('focus-visible:opacity-100');
    expect(classes).toContain('focus-visible:pointer-events-auto');
  });

  // Rendered at the row's far left, so it belongs before the row's inputs in
  // the tab order too.
  it('comes before the row content in the tab order', () => {
    const { container } = render(
      <SwipeToDelete onDelete={vi.fn()} removeLabel="Remove set 1"><input aria-label="Reps" /></SwipeToDelete>,
    );
    const button = screen.getByRole('button', { name: 'Remove set 1' });
    const input = screen.getByLabelText('Reps');

    expect(button.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.group')!.contains(button)).toBe(true);
  });
});
