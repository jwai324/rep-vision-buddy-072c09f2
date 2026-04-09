import React, { useRef, useState } from 'react';
import { ChevronLeft, LogOut, User, Timer, Weight, Camera, Pencil, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import type { WeightUnit, UserPreferences, UserProfile } from '@/hooks/useStorage';

interface SettingsScreenProps {
  preferences: UserPreferences;
  profile: UserProfile;
  onUpdatePreferences: (prefs: Partial<UserPreferences>) => void;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onUploadAvatar: (file: File) => Promise<string | null>;
  onBack: () => void;
}

const UNIT_OPTIONS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lbs', label: 'lbs' },
];

const REST_OPTIONS = [30, 45, 60, 90, 120, 150, 180];

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  preferences, profile, onUpdatePreferences, onUpdateProfile, onUploadAvatar, onBack,
}) => {
  const { user, signOut } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(profile.displayName ?? '');
  const [uploading, setUploading] = useState(false);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    await onUploadAvatar(file);
    setUploading(false);
  };

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
          {/* Avatar */}
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden ring-2 ring-primary/30">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-primary" />
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
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
