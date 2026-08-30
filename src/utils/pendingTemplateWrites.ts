import type { WorkoutTemplate } from '@/types/workout';

/**
 * Template saves that were accepted by the user but never reached Supabase.
 *
 * The update-template prompt at the end of a workout is the case this exists
 * for: it fires exactly once, at the gym, on a phone that may have no signal,
 * and the screen it lives on unmounts a moment later. Without somewhere to
 * park the write, a failed upsert loses the change with nothing to retry —
 * the workout itself still saves (the user is sitting on the summary screen
 * and can press Save again), so the session lands and the template silently
 * does not.
 *
 * Entries are keyed by template id, last-write-wins, and flushed on the next
 * load that has a working connection.
 */
export interface PendingTemplateWrite {
  template: WorkoutTemplate;
  /** ms epoch of the attempt, used to expire writes too old to be trusted. */
  queuedAt: number;
}

const KEY_PREFIX = 'repvision:pending-templates:';
const CACHE_VERSION = 1;

/**
 * A write this old has almost certainly been superseded — by an edit on
 * another device, or by the user redoing it by hand — and replaying it would
 * undo newer work. Drop it instead.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Bounded so a permanently failing write can't grow the entry without limit. */
const MAX_ENTRIES = 25;

const keyFor = (userId: string) => `${KEY_PREFIX}v${CACHE_VERSION}:${userId}`;

function read(userId: string): PendingTemplateWrite[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is PendingTemplateWrite =>
        !!e && typeof e.queuedAt === 'number' && !!e.template && typeof e.template.id === 'string',
    );
  } catch {
    return [];
  }
}

function write(userId: string, entries: PendingTemplateWrite[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(keyFor(userId));
    else localStorage.setItem(keyFor(userId), JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    // Quota or private mode. Nothing to do: the write is lost either way, and
    // the caller has already reported the failure to the user.
  }
}

/** Writes still worth replaying, oldest first. Expired ones are swept here. */
export function readPendingTemplates(userId: string, now = Date.now()): PendingTemplateWrite[] {
  const entries = read(userId);
  const live = entries.filter(e => now - e.queuedAt < MAX_AGE_MS);
  if (live.length !== entries.length) write(userId, live);
  return live;
}

/** Park a template whose save failed. A newer attempt replaces an older one. */
export function queuePendingTemplate(
  userId: string,
  template: WorkoutTemplate,
  now = Date.now(),
): void {
  const rest = read(userId).filter(e => e.template.id !== template.id);
  write(userId, [...rest, { template, queuedAt: now }]);
}

/** Drop a template's queued write — it landed, or was superseded by one that did. */
export function clearPendingTemplate(userId: string, templateId: string): void {
  const entries = read(userId);
  const rest = entries.filter(e => e.template.id !== templateId);
  if (rest.length !== entries.length) write(userId, rest);
}

/** Called on sign-out so the next account on this device starts clean. */
export function clearAllPendingTemplates(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(KEY_PREFIX)) doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  } catch { /* storage unavailable — nothing to sweep */ }
}
