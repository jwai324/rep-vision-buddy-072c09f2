import React, { useEffect, useRef, useCallback } from 'react';

interface RpeWheelPickerProps {
  value: string;
  onChange: (v: string) => void;
  onClose?: () => void;
}

// 19 values: 1, 1.5, 2, ... 9.5, 10
const RPE_VALUES: number[] = Array.from({ length: 19 }, (_, i) => 1 + i * 0.5);
const ITEM_HEIGHT = 36; // px per row
const VISIBLE_ROWS = 5; // odd so there's a clear center
const LIST_HEIGHT = ITEM_HEIGHT * VISIBLE_ROWS;

function formatRpe(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export const RpeWheelPicker: React.FC<RpeWheelPickerProps> = ({ value, onChange, onClose }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimer = useRef<number | null>(null);

  const currentNum = value ? parseFloat(value) : 7;
  const initialIdx = Math.max(
    0,
    RPE_VALUES.findIndex(v => v === (RPE_VALUES.includes(currentNum) ? currentNum : 7)),
  );

  // Auto-scroll to current value on mount
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = initialIdx * ITEM_HEIGHT;
  }, [initialIdx]);

  const handleScroll = useCallback(() => {
    if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = Math.round(el.scrollTop / ITEM_HEIGHT);
      const clamped = Math.max(0, Math.min(RPE_VALUES.length - 1, idx));
      const v = RPE_VALUES[clamped];
      // Snap precisely
      el.scrollTo({ top: clamped * ITEM_HEIGHT, behavior: 'smooth' });
      onChange(formatRpe(v));
    }, 120);
  }, [onChange]);

  const handleTap = (idx: number) => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: idx * ITEM_HEIGHT, behavior: 'smooth' });
    onChange(formatRpe(RPE_VALUES[idx]));
    setTimeout(() => onClose?.(), 150);
  };

  const selectedNum = value ? parseFloat(value) : NaN;

  return (
    <div className="flex flex-col items-stretch w-full">
      <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-muted-foreground text-center">RPE</div>
      <div className="relative">
        {/* Center highlight band */}
        <div
          className="pointer-events-none absolute left-2 right-2 rounded-md bg-primary/15 border border-primary/40"
          style={{ top: (LIST_HEIGHT - ITEM_HEIGHT) / 2, height: ITEM_HEIGHT }}
        />
        {/* Top/bottom fade */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-popover to-transparent z-10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-popover to-transparent z-10" />
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="overflow-y-scroll no-scrollbar"
          style={{
            height: LIST_HEIGHT,
            scrollSnapType: 'y mandatory',
            paddingTop: (LIST_HEIGHT - ITEM_HEIGHT) / 2,
            paddingBottom: (LIST_HEIGHT - ITEM_HEIGHT) / 2,
          }}
        >
          {RPE_VALUES.map((v, idx) => {
            const isSelected = !isNaN(selectedNum) && selectedNum === v;
            return (
              <button
                key={v}
                onClick={() => handleTap(idx)}
                className={`w-full flex items-center justify-center transition-all ${
                  isSelected ? 'text-primary font-bold text-lg' : 'text-foreground/70 text-sm'
                }`}
                style={{ height: ITEM_HEIGHT, scrollSnapAlign: 'center' }}
              >
                {formatRpe(v)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2 px-3 py-2 border-t border-border">
        <button
          onClick={() => {
            onChange('');
            setTimeout(() => onClose?.(), 100);
          }}
          className="flex-1 text-xs py-1.5 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
        >
          Clear
        </button>
        <button
          onClick={() => onClose?.()}
          className="flex-1 text-xs py-1.5 rounded-md bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
        >
          Done
        </button>
      </div>
    </div>
  );
};
