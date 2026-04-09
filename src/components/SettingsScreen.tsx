import React from 'react';
import { ChevronLeft, LogOut, User, Shield, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';

interface SettingsScreenProps {
  onBack: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack }) => {
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
