import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { RpeWheelPicker } from '@/components/RpeWheelPicker';

const ITEM_HEIGHT = 36;

describe('RpeWheelPicker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const renderWheel = (value = '') => {
    const onChange = vi.fn();
    const { container } = render(<RpeWheelPicker value={value} onChange={onChange} />);
    const list = container.querySelector('.overflow-y-scroll') as HTMLDivElement;
    return { onChange, list };
  };

  it('does not commit a value from the scroll the mount itself causes', () => {
    const { onChange, list } = renderWheel('');
    // The browser reports the mount-time scrollTop assignment as a scroll.
    fireEvent.scroll(list);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the value the user scrolled to', () => {
    const { onChange, list } = renderWheel('');
    fireEvent.pointerDown(list);
    Object.defineProperty(list, 'scrollTop', { value: 14 * ITEM_HEIGHT, writable: true });
    fireEvent.scroll(list);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onChange).toHaveBeenCalledWith('8');
  });
});
