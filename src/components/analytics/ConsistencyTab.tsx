import React, { useMemo } from 'react';
import type { WorkoutSession } from '@/types/workout';
import { format, subDays, startOfWeek, addDays } from 'date-fns';
import { parseLocalDate } from '@/utils/dateUtils';

interface ConsistencyTabProps {
  history: WorkoutSession[];
}

export const ConsistencyTab: React.FC<ConsistencyTabProps> = ({ history }) => {
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

    // Calculate current streak (matching dashboard logic: skip today if empty)
    let current = 0;
    let checkDate = today;
    const todayStr = format(today, 'yyyy-MM-dd');
    if (!workoutDates.has(todayStr)) {
      checkDate = subDays(today, 1);
    }
    for (let i = 0; i < 365; i++) {
      const key = format(checkDate, 'yyyy-MM-dd');
      if (workoutDates.has(key)) {
        current++;
        checkDate = subDays(checkDate, 1);
      } else {
        break;
      }
    }

    // Longest streak (using all session dates including rest days)
    let longest = 0;
    const allDates = Array.from(workoutDates).sort();
    if (allDates.length > 0) {
      let tempStreak = 1;
      longest = 1;
      for (let i = 1; i < allDates.length; i++) {
        const prev = new Date(allDates[i - 1] + 'T00:00:00');
        const curr = new Date(allDates[i] + 'T00:00:00');
        const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
        if (diff === 1) {
          tempStreak++;
          longest = Math.max(longest, tempStreak);
        } else {
          tempStreak = 1;
        }
      }
    }

    return { grid: weeks, maxVolume: maxVol, currentStreak: current, longestStreak: longest };
  }, [history]);

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
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mt-1">Current Streak</p>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 text-center">
          <p className="text-3xl font-extrabold text-foreground">{longestStreak}</p>
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mt-1">Longest Streak</p>
        </div>
      </div>

      {/* Contribution grid */}
      <div className="bg-card rounded-xl border border-border p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-3">
          Training Activity (52 weeks)
        </p>
        <div className="flex gap-0.5 overflow-x-auto scrollbar-hide pb-2">
          <div className="flex flex-col gap-0.5 mr-1 pt-0">
            {dayLabels.map((label, i) => (
              <div key={i} className="h-[11px] text-[8px] text-muted-foreground flex items-center justify-end pr-0.5 w-3">
                {i % 2 === 0 ? label : ''}
              </div>
            ))}
          </div>
          {grid.map((week, wi) => (
            <div key={wi} className="flex flex-col gap-0.5">
              {Array.from({ length: 7 }).map((_, di) => {
                const day = week.find(d => d.dayOfWeek === di);
                return (
                  <div
                    key={di}
                    className={`w-[11px] h-[11px] rounded-[2px] ${day ? getIntensity(day.volume) : 'bg-transparent'}`}
                    title={day ? `${day.date}: ${day.volume.toLocaleString()}` : ''}
                  />
                );
              })}
            </div>
          ))}
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
