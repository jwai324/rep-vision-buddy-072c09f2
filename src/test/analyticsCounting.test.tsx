import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { format, subDays } from 'date-fns';
import type { WorkoutSession } from '@/types/workout';
import { VolumeTab } from '@/components/analytics/VolumeTab';
import { BalanceTab } from '@/components/analytics/BalanceTab';
import { FrequencyTab } from '@/components/analytics/FrequencyTab';

const customExercises = vi.hoisted(() => ({
  current: [] as {
    id: string; name: string; primaryBodyPart: string; movementPattern: string;
    equipment: string; isCustom: true; isRecovery: boolean; excludeFromVolume?: boolean;
  }[],
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

const daysAgo = (n: number) => format(subDays(new Date(), n), 'yyyy-MM-dd');

function session(over: Partial<WorkoutSession> & { id: string }): WorkoutSession {
  return {
    date: daysAgo(1), exercises: [], duration: 3600,
    totalVolume: 0, totalSets: 0, totalReps: 0,
    ...over,
  };
}

type WeekRow = Record<string, number | string>;

/** The weekly rows both Volume charts are handed (they share one dataset). */
function volumeRows(): WeekRow[] {
  return JSON.parse(screen.getAllByTestId('chart-data')[0].textContent!) as WeekRow[];
}

const sumOf = (rows: WeekRow[], key: string) =>
  rows.reduce((s, r) => s + ((r[key] as number) ?? 0), 0);

/** Every body-part line's value in a week, i.e. what the lower chart shows. */
const bodyPartTotal = (row: WeekRow) =>
  Object.entries(row).reduce(
    (s, [k, v]) => (k === 'week' || k === 'totalVolume' ? s : s + (v as number)),
    0,
  );

describe('VolumeTab warmups', () => {
  beforeEach(() => { customExercises.current = []; });

  it('leaves warmups out of the weekly total, so it matches the body-part lines', () => {
    // Stored total is frozen at save time and counts the warmup: 60×5 + 100×5×2.
    const history = [session({
      id: 'w1',
      date: daysAgo(2),
      totalVolume: 1300,
      totalSets: 3,
      totalReps: 15,
      exercises: [{
        exerciseId: 'back-squat',
        exerciseName: 'Back Squat',
        sets: [
          { setNumber: 1, type: 'warmup', reps: 5, weight: 60 },
          { setNumber: 2, type: 'normal', reps: 5, weight: 100 },
          { setNumber: 3, type: 'normal', reps: 5, weight: 100 },
        ],
      }],
    })];

    render(<VolumeTab history={history} weightUnit="kg" />);
    const rows = volumeRows();

    expect(sumOf(rows, 'totalVolume')).toBe(1000);
    expect(sumOf(rows, 'Quads')).toBe(1000);
    for (const row of rows) expect(bodyPartTotal(row)).toBe(row.totalVolume);
  });

  it('still nets an excluded exercise out of the total, warmups and all', () => {
    customExercises.current = [{
      id: 'custom-wrist', name: 'Wrist Iso', primaryBodyPart: 'Forearms',
      movementPattern: 'Other', equipment: 'Dumbbell', isCustom: true,
      isRecovery: false, excludeFromVolume: true,
    }];
    const history = [session({
      id: 'w2',
      date: daysAgo(2),
      // squat 300 warmup + 1000 working, wrist iso 50 warmup + 100 working
      totalVolume: 1450,
      exercises: [
        {
          exerciseId: 'back-squat',
          exerciseName: 'Back Squat',
          sets: [
            { setNumber: 1, type: 'warmup', reps: 5, weight: 60 },
            { setNumber: 2, type: 'normal', reps: 5, weight: 100 },
            { setNumber: 3, type: 'normal', reps: 5, weight: 100 },
          ],
        },
        {
          exerciseId: 'custom-wrist',
          exerciseName: 'Wrist Iso',
          sets: [
            { setNumber: 1, type: 'warmup', reps: 10, weight: 5 },
            { setNumber: 2, type: 'normal', reps: 10, weight: 10 },
          ],
        },
      ],
    })];

    render(<VolumeTab history={history} weightUnit="kg" />);
    const rows = volumeRows();

    expect(sumOf(rows, 'totalVolume')).toBe(1000);
    expect(sumOf(rows, 'Forearms')).toBe(0);
    for (const row of rows) expect(bodyPartTotal(row)).toBe(row.totalVolume);
  });

  it('does not net a band warmup out of a total that never carried it', () => {
    // The finish path keeps band work out of totalVolume entirely (a level is
    // not a mass), so there is nothing to subtract for its warmup.
    const history = [session({
      id: 'w3',
      date: daysAgo(2),
      totalVolume: 1000,
      exercises: [
        {
          exerciseId: 'back-squat',
          exerciseName: 'Back Squat',
          sets: [{ setNumber: 1, type: 'normal', reps: 5, weight: 100 },
                 { setNumber: 2, type: 'normal', reps: 5, weight: 100 }],
        },
        {
          exerciseId: 'band-chest-press',
          exerciseName: 'Band Chest Press',
          sets: [
            { setNumber: 1, type: 'warmup', reps: 10, weight: 2 },
            { setNumber: 2, type: 'normal', reps: 10, weight: 4 },
          ],
        },
      ],
    })];

    render(<VolumeTab history={history} weightUnit="kg" />);
    expect(sumOf(volumeRows(), 'totalVolume')).toBe(1000);
  });
});

describe('analytics window edge', () => {
  beforeEach(() => { customExercises.current = []; });

  const squatSession = (id: string, date: string): WorkoutSession => session({
    id,
    date,
    totalVolume: 1000,
    exercises: [{
      exerciseId: 'back-squat',
      exerciseName: 'Back Squat',
      sets: [
        { setNumber: 1, type: 'normal', reps: 5, weight: 100 },
        { setNumber: 2, type: 'normal', reps: 5, weight: 100 },
      ],
    }],
  });

  it('BalanceTab counts a workout exactly at the far edge of the window', () => {
    const { unmount } = render(<BalanceTab history={[squatSession('edge', daysAgo(30))]} />);
    const inWindow = JSON.parse(screen.getByTestId('chart-data').textContent!) as { pattern: string; sets: number }[];
    expect(inWindow).toContainEqual({ pattern: 'Squat', sets: 2 });
    unmount();

    // A day past the edge falls out of the window, and the radar has nothing
    // left to draw.
    render(<BalanceTab history={[squatSession('past', daysAgo(31))]} />);
    expect(screen.queryByTestId('chart-data')).toBeNull();
    expect(screen.getByText('No data for this period.')).toBeInTheDocument();
  });

  it('FrequencyTab counts a workout exactly at the far edge of the window', () => {
    const { unmount } = render(<FrequencyTab history={[squatSession('edge', daysAgo(7))]} />);
    expect(JSON.parse(screen.getByTestId('chart-data').textContent!)).toEqual([
      expect.objectContaining({ bodyPart: 'Quads', sessions: 1 }),
    ]);
    unmount();

    render(<FrequencyTab history={[squatSession('past', daysAgo(8))]} />);
    expect(JSON.parse(screen.getByTestId('chart-data').textContent!)).toEqual([]);
  });
});
