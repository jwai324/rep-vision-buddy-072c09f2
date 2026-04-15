import React, { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { WorkoutSession } from '@/types/workout';
import type { WeightUnit } from '@/hooks/useStorage';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { VolumeTab } from './analytics/VolumeTab';
import { StrengthTab } from './analytics/StrengthTab';
import { FrequencyTab } from './analytics/FrequencyTab';
import { ConsistencyTab } from './analytics/ConsistencyTab';
import { BalanceTab } from './analytics/BalanceTab';
import { SetTypesTab } from './analytics/SetTypesTab';
import { RpeTab } from './analytics/RpeTab';

interface AnalyticsScreenProps {
  history: WorkoutSession[];
  weightUnit: WeightUnit;
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

export const AnalyticsScreen: React.FC<AnalyticsScreenProps> = ({ history, weightUnit, onBack }) => {
  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3 pt-2">
        <button onClick={onBack} className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">Analytics</h1>
      </div>

      <Tabs defaultValue="volume" className="w-full">
        <TabsList className="w-full overflow-x-auto scrollbar-hide flex justify-start gap-0 bg-muted rounded-lg p-1 h-auto flex-nowrap">
          {TABS.map(tab => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-[11px] px-2.5 py-1.5 whitespace-nowrap flex-shrink-0">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="volume"><VolumeTab history={history} weightUnit={weightUnit} /></TabsContent>
        <TabsContent value="strength"><StrengthTab history={history} weightUnit={weightUnit} /></TabsContent>
        <TabsContent value="frequency"><FrequencyTab history={history} /></TabsContent>
        <TabsContent value="consistency"><ConsistencyTab history={history} /></TabsContent>
        <TabsContent value="balance"><BalanceTab history={history} /></TabsContent>
        <TabsContent value="sets"><SetTypesTab history={history} /></TabsContent>
        <TabsContent value="rpe"><RpeTab history={history} /></TabsContent>
      </Tabs>
    </div>
  );
};
