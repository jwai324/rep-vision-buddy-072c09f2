import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { format, subDays } from 'date-fns';
import type { WorkoutSession } from '@/types/workout';
import type { UserPreferences } from '@/hooks/useStorage';
import { ConsistencyTab } from '@/components/analytics/ConsistencyTab';
import { FrequencyTab } from '@/components/analytics/FrequencyTab';
import { AnalyticsScreen } from '@/components/AnalyticsScreen';

const customExercises = vi.hoisted(() => ({
  current: [] as { id: string; name: string; primaryBodyPart: string; equipment: string; isCustom: true; isRecovery: boolean }[],
}));

vi.mock('@/contexts/CustomExercisesContext', () => ({
  useCustomExercisesContext: () => ({
    exercises: customExercises.current,
    loading: false,
    addExercise: vi.fn(),
    deleteExercise: vi.fn(),
    updateExercise: vi.fn(),
  }),
}));

// recharts measures its container and draws nothing at jsdom's 0×0, so the
// charts are stubbed to print the data they were handed.
vi.mock('recharts', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
  const nothing = () => null;
  const chart = ({ data }: { data?: unknown }) => <div data-testid="chart-data">{JSON.stringify(data ?? null)}</div>;
  return {
    ResponsiveContainer: passthrough,
    BarChart: chart, LineChart: chart, RadarChart: chart,
    Bar: nothing, Line: nothing, Radar: nothing, Cell: nothing, Legend: nothing,
    XAxis: nothing, YAxis: nothing, CartesianGrid: nothing, Tooltip: nothing, ReferenceLine: nothing,
    PolarAngleAxis: nothing, PolarGrid: nothing, PolarRadiusAxis: nothing,
  };
});

const prefs: UserPreferences = {
  weightUnit: 'lbs', defaultRestSeconds: 90, defaultDropSetsEnabled: false,
  streakMode: 'daily', streakWeeklyTarget: 3, streakAdjustment: 0, streakAdjustmentSetAt: null,
  tutorialCompleted: false, hideTimers: false, customLocations: [], stickyNotes: {},
};

const daysAgo = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');

function session(over: Partial<WorkoutSession> & { id: string }): WorkoutSession {
  return {
    date: daysAgo(1), exercises: [], duration: 600,
    totalVolume: 0, totalSets: 3, totalReps: 30,
    ...over,
  };
}

describe('ConsistencyTab heat-map', () => {
  const cell = (container: HTMLElement, date: string) =>
    container.querySelector(`[title^="${date}"]`) as HTMLElement;

  it('paints a zero-volume workout as a trained day', () => {
    const bodyweight = daysAgo(3);
    const loaded = daysAgo(5);
    const rest = daysAgo(7);
    const { container } = render(
      <ConsistencyTab
        preferences={prefs}
        history={[
          session({ id: 'bw', date: bodyweight, totalVolume: 0 }),
          session({ id: 'ld', date: loaded, totalVolume: 100 }),
          session({ id: 'rd', date: rest, totalVolume: 0, isRestDay: true }),
        ]}
      />,
    );

    expect(cell(container, bodyweight)).toHaveClass('bg-primary/25');
    expect(cell(container, bodyweight)).not.toHaveClass('bg-secondary');
    expect(cell(container, loaded)).toHaveClass('bg-primary');
    expect(cell(container, rest)).toHaveClass('bg-secondary');
    expect(cell(container, daysAgo(9))).toHaveClass('bg-secondary');
  });

  it("formats the day tooltip in the user's unit", () => {
    const day = daysAgo(2);
    const { container } = render(
      <ConsistencyTab preferences={prefs} history={[session({ id: 'a', date: day, totalVolume: 100 })]} />,
    );
    expect(cell(container, day)).toHaveAttribute('title', `${day}: 220 lbs`);
  });
});

describe('FrequencyTab', () => {
  beforeEach(() => { customExercises.current = []; });

  it('counts a custom exercise that loads after the chart is open', () => {
    const history = [session({
      id: 'neck',
      exercises: [{ exerciseId: 'custom-neck-1', exerciseName: 'Neck Curl', sets: [{ setNumber: 1, type: 'normal', reps: 10 }] }],
    })];
    const { rerender } = render(<FrequencyTab history={history} />);
    expect(JSON.parse(screen.getByTestId('chart-data').textContent!)).toEqual([]);

    customExercises.current = [{ id: 'custom-neck-1', name: 'Neck Curl', primaryBodyPart: 'Neck', equipment: 'Bodyweight', isCustom: true, isRecovery: false }];
    rerender(<FrequencyTab history={history} />);
    expect(JSON.parse(screen.getByTestId('chart-data').textContent!)).toEqual([
      expect.objectContaining({ bodyPart: 'Neck', sessions: 1 }),
    ]);
  });
});

describe('AnalyticsScreen orientation change', () => {
  const orientationListeners = new Set<(e: { matches: boolean }) => void>();
  const original = window.matchMedia;

  beforeEach(() => {
    orientationListeners.clear();
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        if (query.includes('orientation')) orientationListeners.add(cb);
      },
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => { orientationListeners.delete(cb); },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { window.matchMedia = original; });

  it('keeps the selected tab when the phone is rotated', () => {
    render(<AnalyticsScreen history={[]} weightUnit="kg" preferences={prefs} onBack={vi.fn()} />);
    fireEvent.mouseDown(screen.getByRole('tab', { name: /streaks/i }));
    expect(screen.getByRole('tab', { name: /streaks/i })).toHaveAttribute('aria-selected', 'true');

    act(() => { for (const cb of orientationListeners) cb({ matches: true }); });

    expect(screen.getByRole('tab', { name: /streaks/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /volume/i })).toHaveAttribute('aria-selected', 'false');
  });
});
