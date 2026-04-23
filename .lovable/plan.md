

## Persist Focus Mode state across navigation and sleep

### Problem
When the phone goes to sleep or the user navigates away from the active session, Focus Mode closes because `showFocusMode` is a simple `useState(false)` that isn't included in the localStorage cache.

### Fix

**`src/components/ActiveSession.tsx`**:

1. Add `showFocusMode?: boolean` to the `ActiveSessionCache` interface.
2. Include `showFocusMode` in the `safeWriteCache` call (the `useEffect` at ~line 423).
3. Initialize `showFocusMode` state from the cache: change `useState(false)` to `useState(cachedSession?.showFocusMode ?? false)`.

### Files
- Modify: `src/components/ActiveSession.tsx`

