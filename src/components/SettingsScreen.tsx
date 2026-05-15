import React, { useState, useRef } from 'react';
import { ChevronLeft, LogOut, User, Timer, Weight, Pencil, Check, X, ChevronDown, Dumbbell, Flame, GraduationCap, Download, Upload, Volume2, Target, ChevronRight } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { exportUserData, importUserData, validateBackup, getBackupCounts, type RepVisionBackup } from '@/utils/dataPortability';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/AuthContext';
import { useRestTimerSound } from '@/hooks/useRestTimerSound';
import { REST_TIMER_SOUND_OPTIONS } from '@/utils/restTimerSound';
import type { WeightUnit, UserPreferences, UserProfile } from '@/hooks/useStorage';

interface SettingsScreenProps {
  preferences: UserPreferences;
  profile: UserProfile;
  onUpdatePreferences: (prefs: Partial<UserPreferences>) => void;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onBack: () => void;
  onGoToCustomExercises?: () => void;
  onGoToProfile?: () => void;
  onReplayTutorial?: () => void;
}

const UNIT_OPTIONS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'Metric (kg/km)' },
  { value: 'lbs', label: 'Imperial (lb/mi)' },
];

const REST_OPTIONS = [30, 45, 60, 90, 120, 150, 180];
const DataManagementSection: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<RepVisionBackup | null>(null);

  const handleExport = async () => {
    if (!user) return;
    setExporting(true);
    try {
      await exportUserData(supabase, user.id);
      toast({ title: 'Export complete', description: 'Your data has been downloaded.' });
    } catch {
      toast({ title: 'Export failed', description: 'Could not export data.', variant: 'destructive' });
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (!validateBackup(parsed)) {
          toast({ title: 'Invalid file', description: 'This does not look like a RepVision backup.', variant: 'destructive' });
          return;
        }
        setPendingBackup(parsed);
      } catch {
        toast({ title: 'Invalid file', description: 'Could not parse JSON file.', variant: 'destructive' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const confirmImport = async () => {
    if (!user || !pendingBackup) return;
    setImporting(true);
    const result = await importUserData(supabase, user.id, pendingBackup);
    if (result.success) {
      toast({ title: 'Import complete', description: 'Your data has been restored. Reloading…' });
      setTimeout(() => window.location.reload(), 1200);
    } else {
      toast({ title: 'Import failed', description: result.error, variant: 'destructive' });
    }
    setImporting(false);
    setPendingBackup(null);
  };

  const counts = pendingBackup ? getBackupCounts(pendingBackup) : null;

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Data Management</p>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <Button variant="outline" className="w-full justify-start gap-3" onClick={handleExport} disabled={exporting}>
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting...' : 'Export All Data'}
        </Button>
        <Button variant="outline" className="w-full justify-start gap-3" onClick={() => fileInputRef.current?.click()} disabled={importing}>
          <Upload className="w-4 h-4" />
          {importing ? 'Importing...' : 'Import Data'}
        </Button>
        <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileSelect} />
        <p className="text-xs text-muted-foreground">Export downloads a JSON backup of all your workouts, templates, programs, and settings.</p>
      </div>

      {/* Confirmation dialog */}
      {pendingBackup && counts && (
        <div className="px-4 pb-4">
          <div className="bg-secondary rounded-lg p-3 border border-border">
            <p className="text-sm font-semibold text-foreground mb-2">Confirm Import</p>
            <ul className="text-xs text-muted-foreground space-y-0.5 mb-3">
              {counts.sessions > 0 && <li>• {counts.sessions} workout sessions</li>}
              {counts.templates > 0 && <li>• {counts.templates} templates</li>}
              {counts.programs > 0 && <li>• {counts.programs} programs</li>}
              {counts.futureWorkouts > 0 && <li>• {counts.futureWorkouts} future workouts</li>}
              {counts.customExercises > 0 && <li>• {counts.customExercises} custom exercises</li>}
              {counts.hasSettings && <li>• Settings & preferences</li>}
              {counts.hasProfile && <li>• Profile info</li>}
            </ul>
            <p className="text-xs text-muted-foreground mb-3">Existing data with the same IDs will be overwritten.</p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={confirmImport} disabled={importing}>
                {importing ? 'Importing...' : 'Import'}
              </Button>
              <Button size="sm" variant="outline" className="flex-1" onClick={() => setPendingBackup(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  preferences, profile, onUpdatePreferences, onUpdateProfile, onBack, onGoToCustomExercises, onGoToProfile, onReplayTutorial,
}) => {
  const { user, signOut } = useAuth();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.displayName ?? '');
  const { sound: restTimerSound, setSound: setRestTimerSound } = useRestTimerSound();

  const saveName = () => {
    onUpdateProfile({ displayName: nameDraft.trim() || null });
    setEditingName(false);
  };

  const displayName = profile.displayName || user?.email?.split('@')[0] || 'User';

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

      {/* Profile Section */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Profile</p>
        </div>
        <div className="px-4 py-5 flex flex-col items-center gap-4">
          {/* Avatar placeholder */}
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center ring-2 ring-primary/30">
            <User className="w-8 h-8 text-primary" />
          </div>

          {/* Display Name */}
          {editingName ? (
            <div className="flex items-center gap-2 w-full max-w-[240px]">
              <Input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="text-center text-sm h-9"
                placeholder="Display name"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
              />
              <button onClick={saveName} className="p-1.5 rounded-lg text-primary hover:bg-primary/10">
                <Check className="w-4 h-4" />
              </button>
              <button onClick={() => setEditingName(false)} className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setNameDraft(profile.displayName ?? ''); setEditingName(true); }}
              className="flex items-center gap-2 group"
            >
              <span className="text-sm font-semibold text-foreground">{displayName}</span>
              <Pencil className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
            </button>
          )}

          <p className="text-xs text-muted-foreground">{user?.email}</p>
        </div>
      </div>

      {/* Coach Profile link */}
      {onGoToProfile && (
        <button
          onClick={onGoToProfile}
          className="bg-card rounded-xl border border-border overflow-hidden flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors text-left"
        >
          <div className="flex items-center gap-3">
            <Target className="w-4 h-4 text-primary" />
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">Coach Profile</span>
              <span className="text-[11px] text-muted-foreground">Goal, equipment, injuries, bodyweight</span>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
      )}

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

      {/* Rest Timer Sound */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-primary" />
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Rest Timer Sound</p>
        </div>
        <div className="px-4 py-3 grid grid-cols-2 gap-2">
          {REST_TIMER_SOUND_OPTIONS.map(opt => {
            const isActive = restTimerSound === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setRestTimerSound(opt.value)}
                className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          Plays when your rest timer finishes. Race Start begins 3.5s early so the countdown lands on the go.
        </p>
      </div>

      {/* Drop Sets Default */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChevronDown className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Drop Sets</p>
              <p className="text-xs text-muted-foreground">Enable drop sets on exercises by default</p>
            </div>
          </div>
          <Switch
            checked={preferences.defaultDropSetsEnabled}
            onCheckedChange={(checked) => onUpdatePreferences({ defaultDropSetsEnabled: checked })}
          />
        </div>
      </div>

      {/* Hide Timers */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Timer className="w-4 h-4 text-primary" />
            <div>
              <p className="text-sm font-medium text-foreground">Hide Timers</p>
              <p className="text-xs text-muted-foreground">Hide rest timers between sets and exercises by default</p>
            </div>
          </div>
          <Switch
            checked={preferences.hideTimers}
            onCheckedChange={(checked) => onUpdatePreferences({ hideTimers: checked })}
          />
        </div>
      </div>

      {/* Streak Mode */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <Flame className="w-4 h-4 text-primary" />
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Streak</p>
        </div>
        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="flex gap-2">
            {([
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly target' },
            ] as const).map(opt => {
              const isActive = preferences.streakMode === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => onUpdatePreferences({ streakMode: opt.value })}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {preferences.streakMode === 'daily' ? (
            <p className="text-xs text-muted-foreground">
              Counts every consecutive day with a logged workout or rest day.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Counts consecutive weeks (Mon–Sun) with at least the target number of workouts. Rest days don't count.
              </p>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mb-2">Workouts per week</p>
                <div className="grid grid-cols-7 gap-1.5">
                  {[1, 2, 3, 4, 5, 6, 7].map(n => {
                    const isActive = preferences.streakWeeklyTarget === n;
                    return (
                      <button
                        key={n}
                        onClick={() => onUpdatePreferences({ streakWeeklyTarget: n })}
                        className={`py-2 rounded-lg text-sm font-bold transition-colors ${
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* My Exercises */}
      {onGoToCustomExercises && (
        <button
          onClick={onGoToCustomExercises}
          className="w-full bg-card rounded-xl border border-border overflow-hidden text-left"
        >
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Dumbbell className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">My Exercises</p>
                <p className="text-xs text-muted-foreground">Create & manage custom exercises</p>
              </div>
            </div>
            <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
          </div>
        </button>
      )}

      {/* Replay Tutorial */}
      {onReplayTutorial && (
        <button
          onClick={onReplayTutorial}
          className="w-full bg-card rounded-xl border border-border overflow-hidden text-left"
        >
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">Replay Tutorial</p>
                <p className="text-xs text-muted-foreground">Walk through the app tour again</p>
              </div>
            </div>
            <ChevronLeft className="w-4 h-4 text-muted-foreground rotate-180" />
          </div>
        </button>
      )}

      {/* Data Management */}
      <DataManagementSection />

      {/* App Info */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">About</p>
        </div>
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Version</span>
          <span className="text-sm font-mono text-foreground">2.0.0</span>
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
