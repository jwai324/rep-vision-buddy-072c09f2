import React from 'react';
import { ChevronLeft, LogOut, User, Timer, Weight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import type { WeightUnit, UserPreferences } from '@/hooks/useStorage';

interface SettingsScreenProps {
  preferences: UserPreferences;
  onUpdatePreferences: (prefs: Partial<UserPreferences>) => void;
  onBack: () => void;
}

const UNIT_OPTIONS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lbs', label: 'lbs' },
];

const REST_OPTIONS = [30, 45, 60, 90, 120, 150, 180];

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ preferences, onUpdatePreferences, onBack }) => {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background p-4 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={onBack}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-extrabold text-foreground">Settings</h1>
      </div>

      {/* Account Section */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Account</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <User className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{user?.email ?? 'Unknown'}</p>
            <p className="text-xs text-muted-foreground">Signed in</p>
          </div>
        </div>
      </div>

      {/* Weight Unit */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Weight className="w-4 h-4 text-primary" />
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Weight Unit</p>
        </div>
        <div className="px-4 py-3 flex gap-2">
          {UNIT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => onUpdatePreferences({ weightUnit: opt.value })}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                preferences.weightUnit === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Default Rest Timer */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Timer className="w-4 h-4 text-primary" />
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Default Rest Timer</p>
        </div>
        <div className="px-4 py-3 grid grid-cols-4 gap-2">
          {REST_OPTIONS.map(seconds => {
            const label = seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`;
            const isActive = preferences.defaultRestSeconds === seconds;
            return (
              <button
                key={seconds}
                onClick={() => onUpdatePreferences({ defaultRestSeconds: seconds })}
                className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* App Info */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">About</p>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Version</span>
          <span className="text-sm font-mono text-foreground">1.0.0</span>
        </div>
      </div>

      {/* Sign Out */}
      <div className="mt-auto pb-6">
        <Button
          variant="outline"
          className="w-full border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={signOut}
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );
};
