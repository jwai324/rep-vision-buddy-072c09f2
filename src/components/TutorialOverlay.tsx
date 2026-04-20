import React, { useEffect, useLayoutEffect, useState } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTutorial } from '@/contexts/TutorialContext';

const PAD = 8;
const TOOLTIP_GAP = 12;
const TOOLTIP_WIDTH = 300;

export const TutorialOverlay: React.FC = () => {
  const { active, steps, index, next, prev, skip } = useTutorial();
  const step = active ? steps[index] : null;
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Track viewport size to recompute tooltip placement
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    if (!step) { setRect(null); return; }
    if (!step.targetId) { setRect(null); return; }

    let raf = 0;
    const measure = () => {
      const el = document.getElementById(step.targetId!);
      if (!el) {
        // If marked skipIfMissing, advance automatically
        if (step.skipIfMissing) {
          next();
          return;
        }
        setRect(null);
        return;
      }
      // Scroll target into view
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      raf = requestAnimationFrame(() => {
        setRect(el.getBoundingClientRect());
      });
    };

    measure();
    const onScroll = () => {
      const el = document.getElementById(step.targetId!);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [step, next, viewport.w, viewport.h]);

  // ESC to skip
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') skip();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, skip, next, prev]);

  if (!step) return null;

  const isLast = index === steps.length - 1;
  const isFirst = index === 0;

  // Centered fallback if no rect
  const showCentered = !rect;

  // Compute spotlight box (with padding)
  const spotlight = rect ? {
    top: Math.max(0, rect.top - PAD),
    left: Math.max(0, rect.left - PAD),
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  } : null;

  // Compute tooltip position: prefer below, else above
  let tooltipStyle: React.CSSProperties = {};
  if (showCentered) {
    tooltipStyle = {
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: Math.min(TOOLTIP_WIDTH, viewport.w - 32),
    };
  } else if (spotlight) {
    const spaceBelow = viewport.h - (spotlight.top + spotlight.height);
    const spaceAbove = spotlight.top;
    const placeBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;
    const width = Math.min(TOOLTIP_WIDTH, viewport.w - 32);
    let left = spotlight.left + spotlight.width / 2 - width / 2;
    left = Math.max(16, Math.min(viewport.w - width - 16, left));
    tooltipStyle = placeBelow
      ? { top: spotlight.top + spotlight.height + TOOLTIP_GAP, left, width }
      : { bottom: viewport.h - spotlight.top + TOOLTIP_GAP, left, width };
  }

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none animate-fade-in">
      {/* Backdrop with spotlight — 4 dim panels around the target so the target stays clickable */}
      {spotlight ? (
        <>
          {/* Top */}
          <div
            className="fixed pointer-events-none"
            style={{
              top: 0, left: 0, right: 0,
              height: spotlight.top,
              background: 'hsl(var(--background) / 0.85)',
            }}
          />
          {/* Bottom */}
          <div
            className="fixed pointer-events-none"
            style={{
              top: spotlight.top + spotlight.height,
              left: 0, right: 0, bottom: 0,
              background: 'hsl(var(--background) / 0.85)',
            }}
          />
          {/* Left */}
          <div
            className="fixed pointer-events-none"
            style={{
              top: spotlight.top,
              height: spotlight.height,
              left: 0,
              width: spotlight.left,
              background: 'hsl(var(--background) / 0.85)',
            }}
          />
          {/* Right */}
          <div
            className="fixed pointer-events-none"
            style={{
              top: spotlight.top,
              height: spotlight.height,
              left: spotlight.left + spotlight.width,
              right: 0,
              background: 'hsl(var(--background) / 0.85)',
            }}
          />
          {/* Highlight ring (click-through) */}
          <div
            className="fixed pointer-events-none rounded-lg ring-2 ring-primary transition-all duration-300"
            style={{
              top: spotlight.top,
              left: spotlight.left,
              width: spotlight.width,
              height: spotlight.height,
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 pointer-events-none" style={{ background: 'hsl(var(--background) / 0.85)' }} />
      )}

      {/* Tooltip card */}
      <div
        className="fixed pointer-events-auto bg-card border border-primary/40 rounded-xl p-4 shadow-2xl"
        style={tooltipStyle}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="text-sm font-bold text-foreground leading-tight">{step.title}</h3>
          <button
            onClick={skip}
            aria-label="Skip tutorial"
            className="text-muted-foreground hover:text-foreground p-1 -m-1 rounded-md transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed mb-4">{step.body}</p>

        {/* Progress dots */}
        <div className="flex items-center gap-1 mb-3">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all ${
                i === index ? 'w-5 bg-primary' : i < index ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-muted'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={skip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5"
          >
            Skip
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={prev}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
            <button
              onClick={next}
              className="flex items-center gap-1 text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 rounded-md transition-colors"
            >
              {isLast ? 'Got it' : 'Next'}
              {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
