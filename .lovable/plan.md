

## Add undo button when deleting a set

### Change

When a set is deleted via swipe, show a toast notification with an "Undo" button that restores the deleted set to its original position. The toast auto-dismisses after a few seconds.

### Implementation

**`src/components/ActiveSession.tsx`** — in the `removeSet` callback (lines 1044-1060):

1. Before filtering out the set, capture the deleted set data and its position:
   ```tsx
   const removeSet = useCallback((blockIdx: number, setIdx: number) => {
     let deletedSet: SetRow | null = null;

     setBlocks(prev => {
       const block = prev[blockIdx];
       if (!block) return prev;
       deletedSet = { ...block.sets[setIdx] };

       const updated = prev.map((b, bi) => {
         if (bi !== blockIdx) return b;
         const newSets = b.sets.filter((_, si) => si !== setIdx);
         // ... existing renumbering logic ...
         return { ...b, sets: renumbered };
       });
       return updated;
     });

     // Show undo toast after state update
     if (deletedSet) {
       toast('Set deleted', {
         action: {
           label: 'Undo',
           onClick: () => {
             setBlocks(prev => prev.map((b, bi) => {
               if (bi !== blockIdx) return b;
               const restored = [...b.sets];
               restored.splice(setIdx, 0, deletedSet!);
               // Re-renumber sets
               let warmupCount = 0;
               let normalCount = 0;
               const renumbered = restored.map(s => {
                 if (s.type === 'warmup') { warmupCount++; return { ...s, setNumber: warmupCount }; }
                 normalCount++; return { ...s, setNumber: normalCount };
               });
               return { ...b, sets: renumbered };
             }));
           },
         },
       });
     }
   }, []);
   ```

2. Use `toast()` from `sonner` (already imported) with the `action` option, which renders an undo button inside the toast. Sonner supports this natively.

### Files
- Modify: `src/components/ActiveSession.tsx`

