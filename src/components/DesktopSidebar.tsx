import React from 'react';
import { Dumbbell, LayoutDashboard, ClipboardList, Calendar, BarChart3, Settings, Search, Sparkles } from 'lucide-react';

interface DesktopSidebarProps {
  activeScreen: string;
  onNavigate: (screen: string) => void;
}

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'startWorkout', label: 'Workout', icon: Dumbbell },
  { key: 'templates', label: 'Templates', icon: ClipboardList },
  { key: 'programs', label: 'Programs', icon: Calendar },
  { key: 'browseExercises', label: 'Exercises', icon: Search },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  { key: 'aiProgramBuilder', label: 'AI Builder', icon: Sparkles },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({ activeScreen, onNavigate }) => {
  return (
    <aside className="hidden lg:flex flex-col w-56 min-h-screen bg-sidebar-background border-r border-sidebar-border p-4 gap-1 shrink-0">
      <div className="mb-6">
        <h1 className="text-xl font-extrabold text-foreground">RepVision</h1>
        <p className="text-[10px] text-muted-foreground">AI-Powered Tracker</p>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map(item => {
          const isActive = activeScreen === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary/15 text-primary'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground'
              }`}
            >
              <item.icon className="w-4 h-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
