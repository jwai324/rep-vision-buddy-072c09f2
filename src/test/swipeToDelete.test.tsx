import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwipeToDelete } from '@/components/SwipeToDelete';

describe('SwipeToDelete', () => {
  it('settles the row closed when the browser cancels the touch mid-swipe', () => {
    const onDelete = vi.fn();
    render(<SwipeToDelete onDelete={onDelete}><div>Row</div></SwipeToDelete>);
    const content = screen.getByText('Row').parentElement!;

    fireEvent.touchStart(content, { touches: [{ clientX: 200 }] });
    fireEvent.touchMove(content, { touches: [{ clientX: 100 }] });
    expect(content.style.transform).toBe('translateX(-100px)');

    // A scroll the browser takes over ends the gesture with touchcancel.
    fireEvent.touchCancel(content);
    expect(content.style.transform).toBe('translateX(-0px)');
    expect(onDelete).not.toHaveBeenCalled();
  });
});
