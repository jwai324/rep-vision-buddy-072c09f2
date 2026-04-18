import React, { useEffect, useState } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import type { WorkoutSession } from '@/types/workout';
import type { WeightUnit, UserPreferences } from '@/hooks/useStorage';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { VolumeTab } from './analytics/VolumeTab';
import { StrengthTab } from './analytics/StrengthTab';
import { FrequencyTab } from './analytics/FrequencyTab';
import { ConsistencyTab } from './analytics/ConsistencyTab';
import { BalanceTab } from './analytics/BalanceTab';
import { SetTypesTab } from './analytics/SetTypesTab';
import { RpeTab } from './analytics/RpeTab';
import { useIsMobile } from '@/hooks/use-mobile';

interface AnalyticsScreenProps {
  history: WorkoutSession[];
  weightUnit: WeightUnit;
  preferences: UserPreferences;
  onBack: () => void;
}

const TABS = [
  { value: 'volume', label: 'Volume' },
  { value: 'strength', label: 'Strength' },
  { value: 'frequency', label: 'Frequency' },
  { value: 'consistency', label: 'Streaks' },
  { value: 'balance', label: 'Balance' },
  { value: 'sets', label: 'Set Types' },
  { value: 'rpe', label: 'RPE' },
];

const HINT_KEY = 'analytics-rotate-hint-seen';

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({ history, weightUnit, preferences, onBack }) => {
  const isMobile = useIsMobile();
  const [isPortrait, setIsPortrait] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(orientation: portrait)').matches : true
  );
  const [hintSeen, setHintSeen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; }
  });

  useEffect(() => {
    const mql = window.matchMedia('(orientation: portrait)');
    const onChange = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const dismissHint = () => {
    try { localStorage.setItem(HINT_KEY, '1'); } catch {}
    setHintSeen(true);
  };

  const showHint = isMobile && isPortrait && !hintSeen;

  return (
    <div className="analytics-root min-h-screen bg-background p-4 flex flex-col gap-4 overflow-x-hidden w-full max-w-full">
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">Analytics</h1>
      </div>

      {showHint && (
        <div className="flex items-center gap-2 bg-secondary border border-border rounded-lg px-3 py-2">
          <span className="text-base">📱</span>
          <p className="text-xs text-foreground flex-1">Rotate your phone for a wider chart view</p>
          <button
            onClick={dismissHint}
            className="px-2 py-1 rounded-md bg-primary text-primary-foreground text-[11px] font-bold"
          >
            Got it
          </button>
          <button onClick={dismissHint} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <Tabs key={isPortrait ? 'p' : 'l'} defaultValue="volume" className="w-full min-w-0 max-w-full">
        <TabsList className="w-full overflow-x-auto scrollbar-hide flex justify-start gap-0 bg-muted rounded-lg p-1 h-auto flex-nowrap">
          {TABS.map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-[11px] px-2.5 py-1.5 whitespace-nowrap flex-shrink-0">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="volume" className="min-w-0 max-w-full overflow-hidden"><VolumeTab history={history} weightUnit={weightUnit} /></TabsContent>
        <TabsContent value="strength" className="min-w-0 max-w-full overflow-hidden"><StrengthTab history={history} weightUnit={weightUnit} /></TabsContent>
        <TabsContent value="frequency" className="min-w-0 max-w-full overflow-hidden"><FrequencyTab history={history} /></TabsContent>
        <TabsContent value="consistency" className="min-w-0 max-w-full overflow-hidden"><ConsistencyTab history={history} preferences={preferences} /></TabsContent>
        <TabsContent value="balance" className="min-w-0 max-w-full overflow-hidden"><BalanceTab history={history} /></TabsContent>
        <TabsContent value="sets" className="min-w-0 max-w-full overflow-hidden"><SetTypesTab history={history} /></TabsContent>
        <TabsContent value="rpe" className="min-w-0 max-w-full overflow-hidden"><RpeTab history={history} /></TabsContent>
      </Tabs>
    </div>
  );
};
