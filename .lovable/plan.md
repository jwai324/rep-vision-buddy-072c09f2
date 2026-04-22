

## Make Camera Feed collapsible in active session

### Change

Wrap the `CameraFeed` component in `ActiveSession.tsx` with a collapsible section that defaults to collapsed. A small tap-target at the top expands/collapses the camera preview.

### Implementation

**`src/components/ActiveSession.tsx`** (around lines 1600-1604):
- Import `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible`.
- Import `ChevronDown` (or `Camera`) from `lucide-react`.
- Add a `useState<boolean>(false)` for `cameraOpen`.
- Replace the current `<CameraFeed />` block with:

```tsx
<Collapsible open={cameraOpen} onOpenChange={setCameraOpen}>
  <CollapsibleTrigger asChild>
    <button className="w-full flex items-center justify-between px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
      <span className="flex items-center gap-1.5">
        <Camera className="w-3.5 h-3.5" />
        Camera
      </span>
      <ChevronDown className={cn("w-4 h-4 transition-transform", cameraOpen && "rotate-180")} />
    </button>
  </CollapsibleTrigger>
  <CollapsibleContent>
    <div className="px-4 pb-4">
      <CameraFeed />
    </div>
  </CollapsibleContent>
</Collapsible>
```

### Files
- Modify: `src/components/ActiveSession.tsx`

