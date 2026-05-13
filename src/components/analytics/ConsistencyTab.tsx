import React, { useMemo } from 'react';
import type { WorkoutSession } from '@/types/workout';
import { format, subDays, startOfWeek, addDays } from 'date-fns';
import { parseLocalDate } from '@/utils/dateUtils';
import type { UserPreferences } from '@/hooks/useStorage';
import { getCurrentStreak, getLongestStreak } from '@/utils/streak';

interface ConsistencyTabProps {
  history: WorkoutSession[];
  preferences: UserPreferences;
}

export const ConsistencyTab: React.FC<ConsistencyTabProps> = ({ history, preferences }) => {
  const { grid, maxVolume, currentStreak, longestStreak } = useMemo(() => {
    const volumeMap = new Map<string, number>();
    const workoutDates = new Set<string>();

    for (const s of history) {
      const key = format(parseLocalDate(s.date), 'yyyy-MM-dd');
      workoutDates.add(key);
      if (!s.isRestDay) {
        volumeMap.set(key, (volumeMap.get(key) || 0) + s.totalVolume);
      }
    }

    const maxVol = Math.max(...Array.from(volumeMap.values()), 1);

    // Build 52 weeks of data ending today
    const today = new Date();
    const start = startOfWeek(subDays(today, 52 * 7 - 1), { weekStartsOn: 1 });
    const weeks: { date: string; volume: number; dayOfWeek: number }[][] = [];
    let week: typeof weeks[0] = [];
    let cursor = new Date(start);

    while (cursor <= today) {
      const key = format(cursor, 'yyyy-MM-dd');
      const dow = cursor.getDay();
      week.push({ date: key, volume: volumeMap.get(key) || 0, dayOfWeek: dow === 0 ? 6 : dow - 1 });
      if (dow === 0 || cursor.getTime() === today.getTime()) {
        weeks.push(week);
        week = [];
      }
      cursor = addDays(cursor, 1);
    }
    if (week.length > 0) weeks.push(week);

    const current = getCurrentStreak(history, preferences.streakMode, preferences.streakWeeklyTarget);
    const longest = getLongestStreak(history, preferences.streakMode, preferences.streakWeeklyTarget);

    return { grid: weeks, maxVolume: maxVol, currentStreak: current, longestStreak: longest };
  }, [history, preferences.streakMode, preferences.streakWeeklyTarget]);

  const getIntensity = (volume: number) => {
    if (volume === 0) return 'bg-secondary';
    const ratio = volume / maxVolume;
    if (ratio < 0.25) return 'bg-primary/25';
    if (ratio < 0.5) return 'bg-primary/50';
    if (ratio < 0.75) return 'bg-primary/75';
    return 'bg-primary';
  };

  const dayLabels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  return (
    <div className="flex flex-col gap-4">
      {/* Streak stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card rounded-xl border border-border p-4 text-center">
          <p className="text-3xl font-extrabold text-foreground">{currentStreak}</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mt-1">
            Current {preferences.streakMode === 'weekly' ? `Wk Streak (${preferences.streakWeeklyTarget}/wk)` : 'Streak'}
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 text-center">
          <p className="text-3xl font-extrabold text-foreground">{longestStreak}</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mt-1">
            Longest {preferences.streakMode === 'weekly' ? 'Wk Streak' : 'Streak'}
          </p>
        </div>
      </div>

      {/* Contribution grid */}
      <div className="bg-card rounded-xl border border-border p-4 min-w-0 max-w-full overflow-hidden">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
          Training Activity (52 weeks)
        </p>
        <div className="flex gap-[1px] sm:gap-0.5 pb-2 min-w-0 max-w-full">
          <div className="flex flex-col gap-[1px] sm:gap-0.5 mr-1 pt-0 flex-shrink-0">
            {dayLabels.map((label, i) => (
              <div key={i} className="h-[6px] md:h-[11px] text-[8px] text-muted-foreground flex items-center justify-end pr-0.5 w-3">
                {i % 2 === 0 ? label : ''}
              </div>
            ))}
          </div>
          <div className="flex gap-[1px] sm:gap-0.5 flex-1 min-w-0">
            {grid.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[1px] sm:gap-0.5 flex-1 min-w-0">
                {Array.from({ length: 7 }).map((_, di) => {
                  const day = week.find(d => d.dayOfWeek === di);
                  return (
                    <div
                      key={di}
                      className={`w-full aspect-square md:w-[11px] md:h-[11px] rounded-[2px] ${day ? getIntensity(day.volume) : 'bg-transparent'}`}
                      title={day ? `${day.date}: ${day.volume.toLocaleString()}` : ''}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2 justify-end">
          <span className="text-[9px] text-muted-foreground">Less</span>
          <div className="w-[11px] h-[11px] rounded-[2px] bg-secondary" />
          <div className="w-[11px] h-[11px] rounded-[2px] bg-primary/25" />
          <div className="w-[11px] h-[11px] rounded-[2px] bg-primary/50" />
          <div className="w-[11px] h-[11px] rounded-[2px] bg-primary/75" />
          <div className="w-[11px] h-[11px] rounded-[2px] bg-primary" />
          <span className="text-[9px] text-muted-foreground">More</span>
        </div>
      </div>
    </div>
  );
};
