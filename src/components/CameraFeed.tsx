import React from 'react';

export const CameraFeed: React.FC = () => {
  return (
    <div className="relative w-full aspect-[4/3] rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/30 flex flex-col items-center justify-center overflow-hidden">
      {/* Coming Soon badge */}
      <span className="absolute top-3 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground bg-secondary/80 px-3 py-1 rounded-full">Coming Soon</span>
      {/* Skeleton placeholder for camera */}
      <svg
        className="w-24 h-24 text-muted-foreground/40"
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="50" cy="25" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
        <line x1="50" y1="35" x2="50" y2="65" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
        <line x1="50" y1="45" x2="30" y2="55" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
        <line x1="50" y1="45" x2="70" y2="55" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
        <line x1="50" y1="65" x2="35" y2="85" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
        <line x1="50" y1="65" x2="65" y2="85" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
      </svg>
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Camera feed will appear here</span>
        <div className="w-2 h-2 rounded-full bg-set-failure animate-pulse-glow" />
      </div>
    </div>
  );
};
