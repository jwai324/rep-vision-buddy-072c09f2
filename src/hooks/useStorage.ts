import { useState, useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { WorkoutSession, WorkoutTemplate, WorkoutProgram, FutureWorkout } from '@/types/workout';
import type { Database } from '@/integrations/supabase/types';
import { addDays, addWeeks, getDay, format } from 'date-fns';
import { parseLocalDate } from '@/utils/dateUtils';
import { getCurrentStreak, computeDisplayedStreak } from '@/utils/streak';
import { getFutureWorkoutsCompletedBySession } from '@/utils/scheduledWorkout';
import { readStorageCache, writeStorageCache, type CachedStorage } from '@/utils/storageCache';
import { readPendingTemplates, queuePendingTemplate, clearPendingTemplate, resolvePendingTemplates, type PendingTemplateWrite, type PendingTemplateConflict } from '@/utils/pendingTemplateWrites';
import { programOccurrences, programWindow, sanitizeProgramDays } from '@/utils/programFrequency';

type SessionRow = Database['public']['Tables']['workout_sessions']['Row'];
type TemplateRow = Database['public']['Tables']['workout_templates']['Row'];
type ProgramRow = Database['public']['Tables']['workout_programs']['Row'];
type FutureWorkoutRow = Database['public']['Tables']['future_workouts']['Row'];
type SettingsRow = Database['public']['Tables']['user_settings']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];
type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
type BodyMeasurementRow = Database['public']['Tables']['body_measurements']['Row'];
type BodyMeasurementInsert = Database['public']['Tables']['body_measurements']['Insert'];

// A single PostgREST response is trimmed to the project's max-rows (1000 on a
// default Supabase project, and this one sets no `pgrst.db_max_rows` override),
// so asking for a wider range does not widen the answer: the server's cap
// quietly decides what the app knows about. This is the ceiling for the tables
// that cannot outgrow one response; the two that can are read page by page
// (`fetchAllPages`) rather than capped here.
const MAX_ROWS = 5000;
// One page of a paged read. It must never exceed the project's max-rows: a
// page that comes back shorter than asked for is how the loop knows the table
// is exhausted, so a server-side cap below this would read as the end of the
// table and truncate silently all over again.
const PAGE_SIZE = 1000;
// Ceiling on the paging loop, so a table that keeps answering full pages can't
// spin forever. 20 pages is ~55 years of daily scheduled workouts; reaching it
// is logged and told to the user, never absorbed.
const MAX_PAGES = 20;
// Session history cap — loads most-recent 500 sessions eagerly. Deliberate,
// and not something the paging below should quietly undo: 500 covers ~1.4
// years of daily workouts without the memory/startup cost of reading a whole
// history on mobile.
const MAX_SESSIONS = 500;

// Clamp out-of-range or non-integer weekday values into 0-6. Duplicate
// weekday assignments are intentional (a program can schedule two
// workouts on the same day) and pass through untouched.
// Exported for unit testing and for the load-time auto-repair pass.
export function normalizeProgramDays(days: WorkoutProgram['days']): { days: WorkoutProgram['days']; changed: boolean } {
  let changed = false;
  const normalized = days.map((day) => {
    if (!day.frequency || day.frequency.type !== 'weekly') return day;
    const w = day.frequency.weekday;
    if (Number.isInteger(w) && w >= 0 && w <= 6) return day;
    changed = true;
    return { ...day, frequency: { ...day.frequency, weekday: 0 } };
  });
  return { days: normalized, changed };
}

export interface SaveSessionOrigin {
  templateId?: string | null;
  markScheduled?: boolean;
}

// Exported for unit testing — pure, no React/singleton deps.
export function generateFutureWorkouts(program: WorkoutProgram): Omit<FutureWorkout, 'id'>[] {
  const workouts: Omit<FutureWorkout, 'id'>[] = [];
  const { start, end: endDate } = programWindow(program);
  const scheduledDates = new Set<string>();

  // normalizeProgramDays first (the legacy weekday repair), then the shared
  // walker, which validates every frequency: one stored verbatim from a share
  // or a backup can carry the interval of 0 that used to loop forever.
  const { days: normalizedDays } = normalizeProgramDays(program.days);
  for (const occurrence of programOccurrences({ ...program, days: normalizedDays })) {
    const dateStr = format(occurrence.date, 'yyyy-MM-dd');
    scheduledDates.add(dateStr);
    workouts.push({
      programId: program.id,
      date: dateStr,
      templateId: occurrence.templateId,
      label: occurrence.label,
    });
  }

  // Fill in rest days
  let cursor = new Date(start);
  while (cursor < endDate) {
    const dateStr = format(cursor, 'yyyy-MM-dd');
    if (!scheduledDates.has(dateStr)) {
      workouts.push({
        programId: program.id,
        date: dateStr,
        templateId: 'rest',
        label: 'Rest Day',
      });
    }
    cursor = addDays(cursor, 1);
  }

  return workouts;
}

/**
 * The reverse of `getFutureWorkoutsCompletedBySession`: which of a date's
 * ticked-off scheduled entries no longer have a logged session behind them,
 * given `remaining` — everything still logged on that date.
 *
 * Nothing records which entry a given session ticked. The forward pass decides
 * that from the origin template, which lives only in the screen that started
 * the workout, so there is no note to undo. This replays the forward rule over
 * the sessions that are left and releases whatever none of them claims, which
 * is why two workouts logged on one day give back one tick each rather than
 * both: the first remaining session claims the entry it would have claimed
 * when it was saved, and only the surplus is released.
 */
export function futureWorkoutsReleasedOnDate(
  date: string,
  isRestDay: boolean,
  futureWorkouts: FutureWorkout[],
  remaining: WorkoutSession[],
  templates: WorkoutTemplate[],
): FutureWorkout[] {
  const dateStr = format(parseLocalDate(date), 'yyyy-MM-dd');
  const ticked = futureWorkouts.filter(fw =>
    fw.completed === true &&
    format(parseLocalDate(fw.date), 'yyyy-MM-dd') === dateStr &&
    // A rest-day session only ever ticks scheduled rest, and a workout only
    // ever ticks scheduled workouts — the same split the forward pass makes.
    (isRestDay ? fw.templateId === 'rest' : fw.templateId !== 'rest'),
  );
  if (ticked.length === 0) return [];

  let pool: FutureWorkout[] = ticked.map(fw => ({ ...fw, completed: false }));
  const claimed = new Set<string>();
  for (const session of remaining) {
    if (format(parseLocalDate(session.date), 'yyyy-MM-dd') !== dateStr) continue;
    if ((session.isRestDay === true) !== isRestDay) continue;
    for (const fw of getFutureWorkoutsCompletedBySession(session, pool, { templates })) {
      claimed.add(fw.id);
    }
    pool = pool.map(fw => (claimed.has(fw.id) ? { ...fw, completed: true } : fw));
  }
  return ticked.filter(fw => !claimed.has(fw.id));
}

// Map DB row to app type — typed row inputs
function mapSession(row: SessionRow): WorkoutSession {
  return {
    id: row.id,
    date: row.date,
    startedAt: row.started_at ?? undefined,
    exercises: row.exercises as unknown as WorkoutSession['exercises'],
    duration: row.duration,
    totalVolume: Number(row.total_volume),
    totalSets: row.total_sets,
    totalReps: row.total_reps,
    averageRpe: row.average_rpe ? Number(row.average_rpe) : undefined,
    note: row.note ?? undefined,
    location: row.location ?? undefined,
    isRestDay: row.is_rest_day ?? false,
    recoveryActivities: row.recovery_activities as unknown as WorkoutSession['recoveryActivities'],
  };
}

function mapTemplate(row: TemplateRow): WorkoutTemplate {
  return {
    id: row.id,
    name: row.name,
    exercises: row.exercises as unknown as WorkoutTemplate['exercises'],
    updatedAt: row.updated_at,
  };
}

function mapProgram(row: ProgramRow): WorkoutProgram {
  return {
    id: row.id,
    name: row.name,
    days: row.days as unknown as WorkoutProgram['days'],
    durationWeeks: row.duration_weeks ?? 8,
    startDate: row.start_date ?? undefined,
    schedule: row.schedule as unknown as WorkoutProgram['schedule'],
  };
}

// Returns true when nothing that would change which future_workouts exist
// (or when they should land) has changed between two program states. Renaming
// the program, editing days that already match, or resaving with identical
// contents all return true — the caller can then skip the destructive
// delete-and-regenerate cycle that would otherwise wipe user tweaks
// (labels edits, recovery activities, manually-shifted dates) on
// program-linked future_workouts.
function isProgramScheduleEqual(a: WorkoutProgram, b: WorkoutProgram): boolean {
  if ((a.durationWeeks ?? 8) !== (b.durationWeeks ?? 8)) return false;
  if ((a.startDate ?? null) !== (b.startDate ?? null)) return false;
  if (a.days.length !== b.days.length) return false;
  for (let i = 0; i < a.days.length; i++) {
    const da = a.days[i];
    const db = b.days[i];
    if (da.templateId !== db.templateId) return false;
    if (da.label !== db.label) return false;
    // frequency is a small structured object; JSON equality is sufficient
    // and avoids threading a per-variant comparator through this hook.
    if (JSON.stringify(da.frequency ?? null) !== JSON.stringify(db.frequency ?? null)) return false;
  }
  return true;
}

function mapFutureWorkout(row: FutureWorkoutRow): FutureWorkout {
  return {
    id: row.id,
    programId: row.program_id,
    date: row.date,
    templateId: row.template_id,
    label: row.label,
    completed: row.completed ?? false,
    recoveryActivities: row.recovery_activities as unknown as FutureWorkout['recoveryActivities'],
  };
}

export type WeightUnit = 'kg' | 'lbs';

export type StreakMode = 'daily' | 'weekly';

export interface UserPreferences {
  weightUnit: WeightUnit;
  defaultRestSeconds: number;
  defaultDropSetsEnabled: boolean;
  streakMode: StreakMode;
  streakWeeklyTarget: number;
  streakAdjustment: number;
  streakAdjustmentSetAt: string | null;
  tutorialCompleted: boolean;
  hideTimers: boolean;
  customLocations: string[];
  stickyNotes: Record<string, string>;
}

export type Goal = 'hypertrophy' | 'strength' | 'fat_loss' | 'endurance' | 'general' | 'hybrid';
// Sub-goals blended when goal === 'hybrid'. Excludes 'hybrid' itself.
export type HybridGoal = Exclude<Goal, 'hybrid'>;
export const HYBRID_GOAL_VALUES: HybridGoal[] = ['hypertrophy', 'strength', 'fat_loss', 'endurance', 'general'];
export const COACH_NOTES_MAX_LENGTH = 2000;
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type Sex = 'male' | 'female' | 'other' | 'prefer_not_to_say';
export type SubscriptionTier = 'free' | 'premium';

export interface UserProfile {
  displayName: string | null;
  goal: Goal | null;
  hybridGoals: HybridGoal[];
  coachNotes: string | null;
  experienceLevel: ExperienceLevel | null;
  equipment: string[];
  injuries: string[];
  age: number | null;
  sex: Sex | null;
  heightCm: number | null;
  subscriptionTier: SubscriptionTier;
}

export interface BodyMeasurement {
  id: string;
  date: string;
  weightKg: number;
}

export const DEFAULT_PREFERENCES: UserPreferences = { weightUnit: 'lbs', defaultRestSeconds: 90, defaultDropSetsEnabled: false, streakMode: 'daily', streakWeeklyTarget: 3, streakAdjustment: 0, streakAdjustmentSetAt: null, tutorialCompleted: false, hideTimers: false, customLocations: ['Home Gym'], stickyNotes: {} };
const DEFAULT_PROFILE: UserProfile = {
  displayName: null,
  goal: null,
  hybridGoals: [],
  coachNotes: null,
  experienceLevel: null,
  equipment: [],
  injuries: [],
  age: null,
  sex: null,
  heightCm: null,
  subscriptionTier: 'premium',
};

function mapSettingsRow(row: SettingsRow): { activeProgramId: string | null; preferences: UserPreferences } {
  return {
    activeProgramId: row.active_program_id,
    preferences: {
      weightUnit: (row.weight_unit ?? 'lbs') as WeightUnit,
      defaultRestSeconds: row.default_rest_seconds ?? 90,
      defaultDropSetsEnabled: row.default_drop_sets_enabled ?? false,
      streakMode: (row.streak_mode ?? 'daily') as StreakMode,
      streakWeeklyTarget: row.streak_weekly_target ?? 3,
      streakAdjustment: row.streak_adjustment ?? 0,
      streakAdjustmentSetAt: row.streak_adjustment_set_at ?? null,
      tutorialCompleted: row.tutorial_completed ?? false,
      hideTimers: row.hide_timers ?? false,
      customLocations: (row.custom_locations as string[]) ?? ['Home Gym'],
      stickyNotes: (row.sticky_notes as Record<string, string>) ?? {},
    },
  };
}

/**
 * Replay template writes that an earlier session couldn't get through. Runs
 * after a successful load, so a connection good enough to read is the signal
 * to try writing again. Stops at the first failure and leaves the rest queued
 * rather than burning through a batch that is clearly still offline. The
 * caller has already dropped the entries whose row moved on elsewhere
 * (`resolvePendingTemplates`); everything that arrives here is safe to write.
 *
 * saveTemplate and deleteTemplate wait for the replay before writing: a
 * queued version is older than anything the user does after reopening the
 * app, and its upsert landing second would silently replace their edit.
 */
async function flushPendingTemplateWrites(
  userId: string,
  pending: PendingTemplateWrite[],
  onReplayed: (templateId: string, updatedAt: string) => void,
): Promise<void> {
  for (const { template, queuedAt } of pending) {
    // The queue was captured at load. An entry cleared since — a save that
    // landed from another tab, a delete — must not be written over that.
    const stillQueued = readPendingTemplates(userId).some(
      e => e.template.id === template.id && e.queuedAt === queuedAt,
    );
    if (!stillQueued) continue;
    try {
      const { data, error } = await supabase.from('workout_templates').upsert({
        id: template.id,
        user_id: userId,
        name: template.name,
        exercises: template.exercises as unknown as Database['public']['Tables']['workout_templates']['Insert']['exercises'],
      }).select('updated_at').single();
      if (error) {
        console.error('[useStorage] pending template flush failed:', error);
        return;
      }
      clearPendingTemplate(userId, template.id);
      onReplayed(template.id, data.updated_at);
    } catch (e) {
      console.error('[useStorage] pending template flush failed:', e);
      return;
    }
  }
}

/**
 * Read a table a page at a time, the way `exportUserData` already reads one for
 * the backup file. PostgREST trims every response to the project's max-rows, so
 * a table that can outgrow one page has to be asked for the rest explicitly —
 * otherwise the cap decides what the app sees, and for `future_workouts`, which
 * loads in date order, the rows it cuts are the upcoming ones: the week strip
 * and the calendar go thin while the plan is still on the server.
 *
 * `page` must order by something unique as its last term (a primary key will
 * do). Pages are separate queries, and without a total order Postgres is free
 * to answer two of them from different row orders, which loses rows in the
 * overlap and repeats others.
 *
 * The result keeps postgrest-js's `{ data, error }` shape on purpose: a failed
 * page resolves `{ data: null, error }`, so the caller's "every query came back
 * clean" check fails the whole load rather than mistaking the pages gathered so
 * far for the whole table. Rejections (an offline fetch) propagate, as the
 * unpaged reads' do.
 */
async function fetchAllPages<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[] | null; error: unknown; truncated: boolean }> {
  const rows: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const from = p * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) return { data: null, error, truncated: false };
    // A list read answers with rows or with an error. Neither is a shape we
    // understand, and reading it as "that's the end" would truncate silently.
    if (!data) {
      return { data: null, error: new Error(`${label}: a page returned neither rows nor an error`), truncated: false };
    }
    rows.push(...data);
    if (data.length < PAGE_SIZE) return { data: rows, error: null, truncated: false };
  }
  console.error(
    `[useStorage] ${label}: stopped after ${MAX_PAGES} pages (${rows.length} rows) — there are more rows than one load will read.`,
  );
  return { data: rows, error: null, truncated: true };
}

// postgrest-js resolves `{ error }` for a server refusal, but an offline fetch
// rejects; a write that promises a boolean needs the two as one value.
async function writeError(query: PromiseLike<{ error: unknown }>): Promise<unknown> {
  try {
    return (await query).error;
  } catch (e) {
    return e;
  }
}

function pendingConflictMessage({ entry, reason }: PendingTemplateConflict): string {
  const { name } = entry.template;
  return reason === 'deleted'
    ? `${name} was deleted elsewhere — your unsaved update was dropped`
    : `${name} changed elsewhere — your unsaved update from ${format(entry.queuedAt, 'MMM d')} was not applied`;
}

/** Loaded rows with any not-yet-written edits laid back over the top. */
function overlayPendingTemplates(
  loaded: WorkoutTemplate[],
  pending: PendingTemplateWrite[],
): WorkoutTemplate[] {
  const byId = new Map(loaded.map(t => [t.id, t] as const));
  for (const { template } of pending) byId.set(template.id, template);
  return [...byId.values()];
}

export function useStorage() {
  const { user } = useAuth();
  // Supabase hands back a freshly deserialized user object on every auth
  // event — including the token refreshes that fire when the tab regains
  // focus. Keying the load on the id means a same-user refresh no longer
  // re-runs it, which is what used to throw the whole app back to a spinner.
  const userId = user?.id ?? null;
  const [history, setHistory] = useState<WorkoutSession[]>([]);
  // Read by the save path to see the record as it was before this write, and
  // by the scheduled-completion release to see what is still logged on a date.
  const historyRef = useRef(history);
  historyRef.current = history;
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  // Mirrors `templates` for a callback that has to read it without taking it
  // as a dependency: saveTemplate would otherwise change identity on every
  // edit of any template.
  const templatesRef = useRef(templates);
  templatesRef.current = templates;
  // The stamp each replayed write left on its row, for a save that waited on
  // that replay: it read its baseline before the row moved, and the re-stamped
  // row has not rendered into templatesRef by the time it resumes.
  const replayedStamps = useRef(new Map<string, string>());
  const [programs, setPrograms] = useState<WorkoutProgram[]>([]);
  const [activeProgramId, setActiveProgramIdState] = useState<string | null>(null);
  const [futureWorkouts, setFutureWorkouts] = useState<FutureWorkout[]>([]);
  const futureWorkoutsRef = useRef(futureWorkouts);
  futureWorkoutsRef.current = futureWorkouts;
  const [preferences, setPreferencesState] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [profile, setProfileState] = useState<UserProfile>(DEFAULT_PROFILE);
  const [bodyMeasurements, setBodyMeasurements] = useState<BodyMeasurement[]>([]);
  const [loading, setLoading] = useState(true);
  // True while a load runs behind already-visible data. Callers that gate a
  // full-screen spinner should watch `loading`; this is for subtler hints.
  const [refreshing, setRefreshing] = useState(false);
  // True only once every query in a load has come back without an error.
  // Effects that write back to the database must gate on this rather than on
  // `loading`: a failed load also flips `loading` false, and acting on the
  // empty state it leaves behind is how a transient 5xx used to clear a
  // real streak permanently.
  const [loadedOk, setLoadedOk] = useState(false);
  // True when what is on screen belongs to this account: the network confirmed
  // it, or we painted it from this user's own snapshot. False is the dangerous
  // state — a first open whose load failed, where every value is a DEFAULT_*
  // placeholder that looks exactly like a real empty account. Returned as
  // `dataTrusted` because callers outside the hook write whole rows from this
  // state and would otherwise overwrite the real ones with placeholders.
  const [snapshotTrusted, setSnapshotTrusted] = useState(false);
  // Bumped by every write. A load that started before a write and resolved
  // after it holds rows older than the screen; applying them would discard
  // the save, and the next preferences write would then push the stale values
  // back to the server. Such a load is thrown away and run once more.
  const writeSerial = useRef(0);
  const noteWrite = useCallback(() => { writeSerial.current += 1; }, []);
  // The replay of queued template writes after a load. Template writes wait
  // for it, so a queued (older) version can never land on top of a new one.
  const pendingFlush = useRef<Promise<void>>(Promise.resolve());

  // Load all data from Supabase on mount / user change
  useEffect(() => {
    setLoadedOk(false);
    setSnapshotTrusted(false);
    if (!userId) {
      setHistory([]);
      setTemplates([]);
      setPrograms([]);
      setActiveProgramId(null);
      setFutureWorkouts([]);
      setBodyMeasurements([]);
      setLoading(false);
      return;
    }

    // Paint last-known-good data immediately; the network load below then
    // overwrites it. A miss just falls through to the old spinner path.
    const cached = readStorageCache(userId);
    if (cached) {
      setHistory(cached.history);
      setTemplates(cached.templates);
      setPrograms(cached.programs);
      setActiveProgramIdState(cached.activeProgramId);
      setFutureWorkouts(cached.futureWorkouts);
      setPreferencesState(cached.preferences);
      setProfileState(cached.profile);
      setBodyMeasurements(cached.bodyMeasurements);
      setLoading(false);
      setSnapshotTrusted(true);
    }

    // A user switch mid-flight would otherwise let a stale response overwrite
    // the new account's data.
    let cancelled = false;

    let reloads = 0;
    const load = async () => {
      if (cached) setRefreshing(true);
      else setLoading(true);
      const serialAtStart = writeSerial.current;
      let handedOff = false;
      try {
        const [sessionsRes, templatesRes, programsRes, futureRes, settingsRes, profileRes, measurementsRes] = await Promise.all([
          supabase.from('workout_sessions').select('*').eq('user_id', userId).order('date', { ascending: false }).range(0, MAX_SESSIONS - 1),
          supabase.from('workout_templates').select('*').eq('user_id', userId).order('created_at', { ascending: false }).range(0, MAX_ROWS - 1),
          supabase.from('workout_programs').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
          // Read in full rather than capped: a program is ~7 rows a week and
          // nothing ever deletes a deactivated one's remaining weeks, so an
          // account a few plans old passes one page. Ascending by date means
          // the rows a cap cuts are the upcoming ones — the week strip and the
          // calendar thinning out with the plan still on the server. `id` is
          // the primary key and makes the order total: a date is not unique
          // (two workouts a day, and every rest day carries one), and two
          // pages tied on date could otherwise disagree about who came first.
          fetchAllPages<FutureWorkoutRow>('schedule', (from, to) => supabase
            .from('future_workouts').select('*').eq('user_id', userId)
            .order('date', { ascending: true }).order('id', { ascending: true })
            .range(from, to)),
          supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
          supabase.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
          // Paged too: someone logging their weight daily passes one page in
          // under three years, and loading newest-first this one loses the far
          // end of the history instead. Two entries on one day are told apart
          // by when they were logged — ordered by date alone a reload could put
          // the older one first, and the profile and the coach would show it as
          // the latest — and `id` after that is the tiebreak that makes the
          // order total, since created_at is not declared unique.
          fetchAllPages<BodyMeasurementRow>('measurements', (from, to) => supabase
            .from('body_measurements').select('*').eq('user_id', userId)
            .order('date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: true })
            .range(from, to)),
        ]);
        if (cancelled) return;
        if (writeSerial.current !== serialAtStart && reloads < 2) {
          // Something was saved while these rows were in flight. They are
          // already stale; fetch again rather than paint over the save. The
          // replacement owns the loading flags from here: this load's
          // `finally` must not clear what the replacement just set.
          reloads += 1;
          handedOff = true;
          void load();
          return;
        }

        // postgrest-js resolves with an `error` payload rather than throwing,
        // so nothing above reaches the catch. Reading only `.data` meant a
        // failed load painted — and then cached — an empty account.
        const failures = ([
          ['workouts', sessionsRes.error],
          ['templates', templatesRes.error],
          ['programs', programsRes.error],
          ['schedule', futureRes.error],
          ['settings', settingsRes.error],
          ['profile', profileRes.error],
          ['measurements', measurementsRes.error],
        ] as const).filter(([, error]) => error != null);

        if (sessionsRes.data) setHistory(sessionsRes.data.map(mapSession));
        if (templatesRes.data) {
          const loaded = templatesRes.data.map(mapTemplate);
          // A queued write is newer than the row it was built on, so it wins
          // on screen while the replay below catches the row up. A row that
          // has since changed or gone on another device is the newer one
          // instead: that write is dropped and said so, never laid over it.
          const { replay, conflicts } = resolvePendingTemplates(readPendingTemplates(userId), loaded);
          for (const conflict of conflicts) {
            clearPendingTemplate(userId, conflict.entry.template.id);
            toast.error(pendingConflictMessage(conflict));
          }
          setTemplates(replay.length ? overlayPendingTemplates(loaded, replay) : loaded);
          if (replay.length) {
            pendingFlush.current = flushPendingTemplateWrites(userId, replay, (id, updatedAt) => {
              replayedStamps.current.set(id, updatedAt);
              // Only the stamp: the row on screen may already hold an edit
              // made while the replay was in flight, which saveTemplate is
              // waiting on this flush to write.
              setTemplates(prev => prev.map(t => (t.id === id ? { ...t, updatedAt } : t)));
            });
          }
        }
        if (programsRes.data) setPrograms(programsRes.data.map(mapProgram));
        if (futureRes.data) setFutureWorkouts(futureRes.data.map(mapFutureWorkout));
        if (settingsRes.data) {
          const mapped = mapSettingsRow(settingsRes.data);
          setActiveProgramIdState(mapped.activeProgramId);
          setPreferencesState(mapped.preferences);
        }
        if (profileRes.data) {
          const row = profileRes.data;
          setProfileState({
            displayName: row.display_name ?? null,
            goal: (row.goal as Goal | null) ?? null,
            hybridGoals: (row.hybrid_goals ?? []).filter((g): g is HybridGoal => (HYBRID_GOAL_VALUES as string[]).includes(g)),
            coachNotes: row.coach_notes ?? null,
            experienceLevel: (row.experience_level as ExperienceLevel | null) ?? null,
            equipment: row.equipment ?? [],
            injuries: row.injuries ?? [],
            age: row.age ?? null,
            sex: (row.sex as Sex | null) ?? null,
            heightCm: row.height_cm != null ? Number(row.height_cm) : null,
            subscriptionTier: (row.subscription_tier as SubscriptionTier) ?? 'premium',
          });
        }
        if (measurementsRes.data) {
          setBodyMeasurements(measurementsRes.data.map(r => ({
            id: r.id,
            date: r.date,
            weightKg: Number(r.weight_kg),
          })));
        }

        // A table too big to finish reading is said out loud. Truncation that
        // nothing mentions is the whole defect this paging replaced, and these
        // two lists are read by screens ("what's next", the weight chart) that
        // look perfectly normal while they are missing their far end.
        if (futureRes.truncated) {
          toast.error("You have more scheduled workouts than one load can read — the furthest-out dates aren't shown.");
        }
        if (measurementsRes.truncated) {
          toast.error("You have more bodyweight entries than one load can read — the oldest aren't shown.");
        }

        if (failures.length) {
          for (const [label, error] of failures) {
            console.error(`[useStorage] Failed to load ${label}:`, error);
          }
          // Said even when cached data is on screen: without it a stale
          // snapshot is indistinguishable from live data, and the user can
          // edit against numbers the server never confirmed.
          toast.error(
            cached
              ? "Couldn't refresh your data — showing what was last saved."
              : 'Failed to load your data',
          );
        } else {
          setLoadedOk(true);
          setSnapshotTrusted(true);
        }
      } catch (e) {
        if (cancelled) return;
        console.error('[useStorage] Failed to load data:', e);
        // Cached data is still on screen and still usable, so a failed
        // background refresh doesn't warrant interrupting the user.
        if (!cached) toast.error('Failed to load your data');
      } finally {
        if (!cancelled && !handedOff) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [userId]);

  // Snapshot after every settle, so the next open has something to paint.
  // Runs on real data changes too, not just loads, which keeps the cache warm
  // as the user edits.
  useEffect(() => {
    if (!userId || loading) return;
    // Only ever persist a snapshot we can stand behind. A first open whose
    // load failed has nothing but placeholders, and caching those as
    // last-known-good is what re-ran the tutorial over a real account.
    if (!snapshotTrusted) return;
    const snapshot: CachedStorage = {
      history, templates, programs, activeProgramId,
      futureWorkouts, preferences, profile, bodyMeasurements,
    };
    writeStorageCache(userId, snapshot);
  }, [userId, loading, snapshotTrusted, history, templates, programs, activeProgramId, futureWorkouts, preferences, profile, bodyMeasurements]);

  const setActiveProgramId = useCallback((id: string | null) => {
    setActiveProgramIdState(id);
  }, []);

  /**
   * Put back the ticks a date no longer has a session behind. The mirror of
   * the completion write below, down to only applying the rows the server
   * took; a refused update leaves the entry ticked rather than lying locally.
   */
  const releaseScheduledCompletions = useCallback(async (
    date: string,
    isRestDay: boolean,
    remaining: WorkoutSession[],
  ): Promise<void> => {
    if (!user) return;
    const release = futureWorkoutsReleasedOnDate(
      date, isRestDay, futureWorkoutsRef.current, remaining, templatesRef.current,
    );
    if (release.length === 0) return;
    const errors = await Promise.all(release.map(fw =>
      writeError(
        supabase.from('future_workouts').update({ completed: false }).eq('id', fw.id).eq('user_id', user.id),
      ),
    ));
    const clearedIds = new Set(
      release.filter((_, i) => !errors[i]).map(fw => fw.id),
    );
    if (clearedIds.size < release.length) {
      console.error('[useStorage] scheduled workout release: some updates failed');
    }
    setFutureWorkouts(prev => prev.map(fw => clearedIds.has(fw.id) ? { ...fw, completed: false } : fw));
  }, [user]);

  /**
   * Persist a session. `origin.templateId` is the template the workout was
   * started from, when there is one; it decides which of the day's scheduled
   * workouts the session marks done, and is not stored on the session itself.
   * `markScheduled: false` is for editing a past record: a correction is not
   * a workout done, so it must not tick off whatever is scheduled that day.
   */
  // Resolves false when the workout did not reach the server, so the caller can
  // keep the summary screen and the local session cache alive for a retry. It
  // never throws: an offline fetch rejects rather than resolving with an error
  // payload, and an unhandled rejection here used to leave the caller believing
  // the save had succeeded while it tore down the only other copy.
  const saveSessionNow = useCallback(async (session: WorkoutSession, origin: SaveSessionOrigin = {}): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    // Captured before the write: the record as this date's calendar knew it.
    const priorRecord = historyRef.current.find(s => s.id === session.id);
    let error: unknown = null;
    try {
      ({ error } = await supabase.from('workout_sessions').upsert({
        id: session.id,
        user_id: user.id,
        date: session.date,
        started_at: session.startedAt ?? null,
        exercises: session.exercises as unknown as Database['public']['Tables']['workout_sessions']['Insert']['exercises'],
        duration: session.duration,
        total_volume: session.totalVolume,
        total_sets: session.totalSets,
        total_reps: session.totalReps,
        average_rpe: session.averageRpe ?? null,
        note: session.note ?? null,
        location: session.location ?? null,
        is_rest_day: session.isRestDay ?? false,
        recovery_activities: session.recoveryActivities as unknown as Database['public']['Tables']['workout_sessions']['Insert']['recovery_activities'] ?? null,
      }));
    } catch (e) {
      error = e;
    }
    if (error) {
      console.error('[useStorage] saveSession error:', error);
      toast.error('Couldn\'t save this workout — check your connection and tap Save again');
      return false;
    }
    setHistory(prev => {
      const exists = prev.findIndex(s => s.id === session.id);
      if (exists >= 0) return prev.map(s => s.id === session.id ? session : s);
      return [session, ...prev];
    });

    // A record moved to another day leaves the old day's plan ticked off with
    // nothing behind it. The old tick is cleared rather than carried across:
    // which entry a session ticked is never stored, so there is nothing to
    // move, and the new date is marked from scratch by the rule below — which
    // already knows about that day's own plan and whatever else is logged on
    // it. Guessing an entry on the new date would tick off a workout the user
    // never did.
    if (priorRecord && priorRecord.date !== session.date) {
      await releaseScheduledCompletions(
        priorRecord.date,
        priorRecord.isRestDay === true,
        historyRef.current.filter(s => s.id !== session.id),
      );
    }

    // Flag matching scheduled workouts as done rather than deleting them — the
    // day's plan stays on the calendar and can still be started again.
    const matchingFws = origin.markScheduled === false ? [] : getFutureWorkoutsCompletedBySession(session, futureWorkouts, {
      templateId: origin.templateId,
      templates,
    });
    if (matchingFws.length > 0) {
      const updateResults = await Promise.all(
        matchingFws.map(fw =>
          supabase.from('future_workouts').update({ completed: true }).eq('id', fw.id).eq('user_id', user.id)
        )
      );
      const updatedIds = new Set(
        updateResults
          .map((r, i) => (r.error ? null : matchingFws[i].id))
          .filter((id): id is string => id !== null)
      );
      if (updatedIds.size < matchingFws.length) {
        console.error('[useStorage] scheduled workout completion: some updates failed');
      }
      setFutureWorkouts(prev => prev.map(fw => updatedIds.has(fw.id) ? { ...fw, completed: true } : fw));
    }
    return true;
  }, [user, futureWorkouts, templates, releaseScheduledCompletions]);

  // Writes to one session row are chained rather than raced. The summary's
  // recovery-activity chips fire a save per tap, and two in flight at once
  // can arrive at the server out of order, leaving the row holding the
  // earlier of the two. Chained, not deduped: each call carries different
  // data, so all of them have to land — just in order.
  const saveChains = useRef<Map<string, Promise<boolean>>>(new Map());
  const saveSession = useCallback((session: WorkoutSession, origin: SaveSessionOrigin = {}): Promise<boolean> => {
    const prior = saveChains.current.get(session.id) ?? Promise.resolve(true);
    // saveSessionNow never rejects, so the chain can't be poisoned.
    const next = prior.then(() => saveSessionNow(session, origin));
    saveChains.current.set(session.id, next);
    void next.then(() => {
      if (saveChains.current.get(session.id) === next) saveChains.current.delete(session.id);
    });
    return next;
  }, [saveSessionNow]);

  const applyTemplateLocally = useCallback((template: WorkoutTemplate) => {
    setTemplates(prev => {
      const exists = prev.findIndex(t => t.id === template.id);
      if (exists >= 0) return prev.map(t => t.id === template.id ? template : t);
      return [...prev, template];
    });
  }, []);

  /**
   * Persist a template. Resolves true only once the row is actually written.
   *
   * A failure keeps the edit rather than dropping it: the new version is
   * applied locally and parked in the pending queue, which the next successful
   * load replays. That matters most for the finish-a-workout prompt, whose
   * screen unmounts moments later and so has nowhere of its own to retry from.
   */
  const saveTemplate = useCallback(async (template: WorkoutTemplate): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    // The stamp of the row this edit was built on, read before the local
    // apply below replaces it; a queued write is checked against it on
    // replay. null is a template new to this device. undefined is one whose
    // stamp is not known, which the queue replays unconditionally.
    const current = templatesRef.current.find(t => t.id === template.id);
    let baseline = current ? current.updatedAt : null;
    // Applied before the round trip: the edit is kept whatever the outcome
    // below, and a list that lacked the template until the server answered
    // is what invited a second tap on Duplicate.
    applyTemplateLocally(template);
    await pendingFlush.current;
    // A replay that landed during that wait is what the row carries now, and
    // queued against the older stamp this edit would be dropped as a conflict
    // on the next load. Taken once: a later save's own row holds anything newer.
    const replayed = replayedStamps.current.get(template.id);
    if (replayed !== undefined) {
      baseline = replayed;
      replayedStamps.current.delete(template.id);
    }
    let updatedAt: string | undefined;
    let error: unknown = null;
    try {
      const res = await supabase.from('workout_templates').upsert({
        id: template.id,
        user_id: user.id,
        name: template.name,
        exercises: template.exercises as unknown as Database['public']['Tables']['workout_templates']['Insert']['exercises'],
      }).select('updated_at').single();
      error = res.error;
      updatedAt = res.data?.updated_at;
    } catch (e) {
      // An offline fetch rejects rather than resolving with an error payload.
      error = e;
    }
    if (error) {
      console.error('[useStorage] saveTemplate error:', error);
      toast.error('Failed to save template — it will retry when you\'re back online');
      queuePendingTemplate(user.id, template, baseline);
      return false;
    }
    clearPendingTemplate(user.id, template.id);
    // Applied again once the row is on the server, now carrying the stamp the
    // server gave it: a load that resolved in between read the pre-write rows
    // and painted over the early apply.
    applyTemplateLocally({ ...template, updatedAt });
    return true;
  }, [user, applyTemplateLocally]);

  const deleteTemplate = useCallback(async (id: string): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    await pendingFlush.current;
    const error = await writeError(supabase.from('workout_templates').delete().eq('id', id).eq('user_id', user.id));
    if (error) {
      console.error('[useStorage] deleteTemplate error:', error);
      toast.error('Failed to delete template');
      return false;
    }
    // Otherwise a queued write for this template would recreate it on the
    // next load.
    clearPendingTemplate(user.id, id);
    // The row is gone, so a stamp the replay left on it is no baseline for
    // anything written under this id again.
    replayedStamps.current.delete(id);
    setTemplates(prev => prev.filter(t => t.id !== id));
    return true;
  }, [user]);

  // Resolves true only once the program row is written. Both builders used to
  // toast "saved", clear their draft and leave the screen before this had
  // resolved, so a failed upsert lost the whole program — and, for the AI
  // builder, the credits spent generating it.
  const saveProgram = useCallback(async (input: WorkoutProgram): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    // What is written is what every reader will trust: a frequency that
    // arrived invalid (the coach's tool, a share, a backup, or a row saved
    // before validation existed) is dropped here, so the stored program can
    // never carry the interval-0 hang back into the app.
    const program: WorkoutProgram = { ...input, days: sanitizeProgramDays(input.days) };
    // Snapshot the pre-save version so we can decide whether the schedule
    // shape (days, frequencies, duration, startDate) actually changed. A pure
    // rename or metadata-only edit should NOT wipe program-linked
    // future_workouts, which carry per-workout state (recovery activities,
    // completed flags, manually-shifted dates).
    const existing = programs.find(p => p.id === program.id);
    const scheduleChanged = !existing || !isProgramScheduleEqual(existing, program);

    let error: unknown = null;
    try {
      ({ error } = await supabase.from('workout_programs').upsert({
        id: program.id,
        user_id: user.id,
        name: program.name,
        days: program.days as unknown as Database['public']['Tables']['workout_programs']['Insert']['days'],
        duration_weeks: program.durationWeeks ?? 8,
        start_date: program.startDate ?? null,
        schedule: program.schedule as unknown as Database['public']['Tables']['workout_programs']['Insert']['schedule'] ?? null,
      }));
    } catch (e) {
      // An offline fetch rejects rather than resolving with an error payload.
      error = e;
    }
    if (error) {
      console.error('[useStorage] saveProgram error:', error);
      toast.error('Failed to save program');
      return false;
    }
    setPrograms(prev => {
      const exists = prev.findIndex(p => p.id === program.id);
      if (exists >= 0) return prev.map(p => p.id === program.id ? program : p);
      return [...prev, program];
    });

    // Only regenerate future_workouts when the schedule shape actually
    // changed. Pure renames / metadata edits skip the destructive path.
    if (!scheduleChanged) return true;

    // Regenerate this program's calendar from today forward. Two rules that
    // the old delete-everything-then-insert broke:
    //  - Past and completed rows are the program's history (done flags,
    //    recovery activities, dates the user shifted by hand). They stay.
    //  - The new rows go in before the old ones come out, so a failed insert
    //    leaves the previous schedule in place rather than an empty server
    //    behind a screen that still shows rows.
    const today = format(new Date(), 'yyyy-MM-dd');
    // A row already completed on or after today survives (see below), so the
    // same workout is not scheduled a second time next to it — today's
    // finished session would otherwise show as "1 of 2, start again".
    const alreadyDone = new Set(
      futureWorkouts
        .filter(fw => fw.programId === program.id && fw.completed === true && fw.date >= today)
        .map(fw => `${fw.date}|${fw.templateId}`),
    );
    const futureFws = generateFutureWorkouts(program)
      .filter(fw => fw.date >= today && !alreadyDone.has(`${fw.date}|${fw.templateId}`));

    let insertedIds: string[] = [];
    let inserted: FutureWorkout[] = [];
    // The server's own clock, read off the rows it just wrote: everything
    // older than this is the previous schedule. An id list here grew with the
    // program — 48 weeks of daily rows is a 13 KB URL, past the edge's limit
    // for a program with two workouts on a weekday — and a refused delete
    // doubled every date.
    let retireBefore: string | null = null;
    if (futureFws.length > 0) {
      const rows = futureFws.map(fw => ({
        user_id: user.id,
        program_id: fw.programId,
        date: fw.date,
        template_id: fw.templateId,
        label: fw.label,
        completed: false,
      }));
      const { data, error: insertError } = await supabase.from('future_workouts').insert(rows).select();
      if (insertError || !data) {
        console.error('[useStorage] future workouts insert error:', insertError);
        toast.error('Program saved, but its calendar could not be updated');
        return true;
      }
      inserted = data.map(mapFutureWorkout);
      insertedIds = inserted.map(fw => fw.id);
      retireBefore = data.reduce<string | null>((min, row) => (min === null || row.created_at < min ? row.created_at : min), null);
    }

    // Retire the superseded upcoming rows: this program, today or later, not
    // completed, and written before the rows that replace them.
    let retire = supabase
      .from('future_workouts')
      .delete()
      .eq('program_id', program.id)
      .eq('user_id', user.id)
      .gte('date', today)
      .or('completed.is.null,completed.eq.false');
    if (retireBefore) retire = retire.lt('created_at', retireBefore);
    else if (insertedIds.length > 0) retire = retire.not('id', 'in', `(${insertedIds.join(',')})`);
    const { error: deleteError } = await retire;
    if (deleteError) {
      console.error('[useStorage] future workouts delete error:', deleteError);
      toast.error('Program saved, but old scheduled workouts could not be cleared');
      // The new rows are in; the stale ones will show until the next save.
    }

    setFutureWorkouts(prev => {
      const kept = prev.filter(fw =>
        fw.programId !== program.id
        || fw.date < today
        || fw.completed === true
        || (deleteError != null && !insertedIds.includes(fw.id)));
      return [...kept, ...inserted].sort((a, b) => a.date.localeCompare(b.date));
    });
    return true;
  }, [user, programs, futureWorkouts]);

  // Auto-heal previously-saved programs whose stored day.frequency values
  // collide on the same weekday (a bug in older AI Coach output that
  // silently dropped a day from the calendar). On first load after this
  // ships, saveProgram gets called with the normalized days — that both
  // rewrites program.days in the DB and regenerates future_workouts. The
  // ref keeps us from re-firing for the same program id if state churns.
  const repairedProgramIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    // loadedOk, not !loading: this writes back to the database, so it must
    // never run against a hydrated-only or partially-failed load.
    if (!user || !loadedOk) return;
    for (const p of programs) {
      if (repairedProgramIds.current.has(p.id)) continue;
      const { days: normalized, changed } = normalizeProgramDays(p.days);
      // A row that predates frequency validation can still hold the
      // interval-0 loop; the readers all validate, but the stored program is
      // healed here so it stops being a hazard for anything that does not.
      const days = sanitizeProgramDays(normalized);
      if (!changed && JSON.stringify(days) === JSON.stringify(p.days)) continue;
      repairedProgramIds.current.add(p.id);
      saveProgram({ ...p, days });
    }
  }, [user, loadedOk, programs, saveProgram]);

  // Auto-clear of the streak adjustment when the new mode has actually
  // produced a break is set up further below, after updatePreferences is
  // defined — see the "clearedAdjustmentAt" effect.

  const setActiveProgram = useCallback(async (id: string | null): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    const previous = activeProgramId;
    setActiveProgramIdState(id);
    const { error } = await supabase.from('user_settings').upsert({
      user_id: user.id,
      active_program_id: id,
    }, { onConflict: 'user_id' });
    if (error) {
      console.error('[useStorage] setActiveProgram error:', error);
      toast.error('Failed to set active program');
      setActiveProgramIdState(previous); // rollback, like every other write here
      return false;
    }
    return true;
  }, [user, activeProgramId]);

  // Resolves true only once the program row is gone. The calendar rows go
  // first and their delete is checked: there is no foreign key between the
  // two tables, so a row left pointing at a deleted program is a ghost that
  // reappears on every load and blocks deleting the templates it names.
  const deleteProgram = useCallback(async (id: string): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    const calendarError = await writeError(supabase.from('future_workouts').delete().eq('program_id', id).eq('user_id', user.id));
    if (calendarError) {
      console.error('[useStorage] deleteProgram error:', calendarError);
      toast.error('Failed to delete program');
      return false;
    }
    setFutureWorkouts(prev => prev.filter(fw => fw.programId !== id));
    const error = await writeError(supabase.from('workout_programs').delete().eq('id', id).eq('user_id', user.id));
    if (error) {
      console.error('[useStorage] deleteProgram error:', error);
      toast.error('Failed to delete program');
      return false;
    }
    setPrograms(prev => prev.filter(p => p.id !== id));
    // Settings and the coach's context would otherwise keep naming a program
    // that no longer exists.
    if (activeProgramId === id) await setActiveProgram(null);
    return true;
  }, [user, activeProgramId, setActiveProgram]);

  const deleteSession = useCallback(async (id: string) => {
    noteWrite();
    if (!user) return;
    // Capture for rollback
    const previous = history;
    const removed = previous.find(s => s.id === id);
    setHistory(prev => prev.filter(s => s.id !== id));
    const { error } = await supabase.from('workout_sessions').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      console.error('[useStorage] deleteSession error:', error);
      toast.error('Failed to delete session');
      setHistory(previous); // rollback
      return;
    }
    // The plan this workout ticked off goes back to outstanding (or missed,
    // once the date is past). Without it the calendar shows an empty day
    // sitting over a day the program still counts as done.
    if (removed) {
      await releaseScheduledCompletions(
        removed.date,
        removed.isRestDay === true,
        previous.filter(s => s.id !== id),
      );
    }
  }, [user, history, releaseScheduledCompletions]);

  const updateFutureWorkout = useCallback(async (updated: FutureWorkout): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    const error = await writeError(supabase.from('future_workouts').upsert({
      id: updated.id,
      user_id: user.id,
      program_id: updated.programId,
      date: updated.date,
      template_id: updated.templateId,
      label: updated.label,
      completed: updated.completed ?? false,
      recovery_activities: updated.recoveryActivities as unknown as Database['public']['Tables']['future_workouts']['Insert']['recovery_activities'] ?? null,
    }));
    if (error) {
      console.error('[useStorage] updateFutureWorkout error:', error);
      toast.error('Failed to update future workout');
      return false;
    }
    setFutureWorkouts(prev => {
      const exists = prev.some(fw => fw.id === updated.id);
      if (exists) return prev.map(fw => fw.id === updated.id ? updated : fw);
      return [...prev, updated];
    });
    return true;
  }, [user]);

  const deleteFutureWorkout = useCallback(async (id: string): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    const error = await writeError(supabase.from('future_workouts').delete().eq('id', id).eq('user_id', user.id));
    if (error) {
      console.error('[useStorage] deleteFutureWorkout error:', error);
      toast.error('Failed to delete scheduled workout');
      return false;
    }
    setFutureWorkouts(prev => prev.filter(fw => fw.id !== id));
    return true;
  }, [user]);

  // A second tap while a shift is in flight would move the calendar twice:
  // the RPC has no idempotency key and the button stays live until it answers.
  const shiftInFlight = useRef(false);

  const pushProgramBack = useCallback(async (programId: string, fromDate: string, days: number) => {
    if (!user || days <= 0) return;
    if (days > 366) {
      toast.error('Shift by 1 to 366 days');
      return;
    }
    if (shiftInFlight.current) return;
    const program = programs.find(p => p.id === programId);
    // The RPC writes the program's days as given, so without the local copy
    // there is nothing correct to send.
    if (!program) return;
    // Noted only once a write is actually attempted: a refused double tap
    // must not make an in-flight load discard itself.
    noteWrite();
    shiftInFlight.current = true;
    try {
      const isIsoDay = (dateStr: string) => /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
      const shiftDate = (dateStr: string): string => format(addDays(parseLocalDate(dateStr), days), 'yyyy-MM-dd');
      // Sanitized before the anchors move, as saveProgram does: a malformed
      // anchor (a restored backup is written verbatim) is dropped rather than
      // parsed, and the shifted result is valid by construction. This one
      // object is what is sent and what is shown. A start date that is not a
      // YYYY-MM-DD is dropped the same way rather than thrown on by `format`
      // (or refused by the function, which would leave the program unshiftable).
      const shifted: WorkoutProgram = {
        ...program,
        startDate: program.startDate && isIsoDay(program.startDate) ? shiftDate(program.startDate) : undefined,
        days: sanitizeProgramDays(program.days).map(day => (
          day.frequency?.type === 'everyNDays' && day.frequency.startDate
            ? { ...day, frequency: { ...day.frequency, startDate: shiftDate(day.frequency.startDate) } }
            : day
        )),
      };

      // One transaction moves the rows and the program's dates together, so
      // a failure leaves nothing half-shifted (audit 4.19). The generated Args
      // say string and Json, but the function takes NULL for a program with
      // no start date (an imported one has none) and days is a ProgramDay[]
      // bound for a jsonb column.
      type ShiftArgs = Database['public']['Functions']['shift_program_workouts']['Args'];
      let moved = 0;
      let error: unknown = null;
      try {
        const res = await supabase.rpc('shift_program_workouts', {
          p_program_id: programId,
          p_from_date: fromDate,
          p_days: days,
          p_start_date: (shifted.startDate ?? null) as unknown as ShiftArgs['p_start_date'],
          p_program_days: shifted.days as unknown as ShiftArgs['p_program_days'],
        });
        error = res.error;
        moved = res.data ?? 0;
      } catch (e) {
        // An offline fetch rejects rather than resolving with an error payload.
        error = e;
      }
      if (error) {
        console.error('[useStorage] pushProgramBack error:', error);
        toast.error('Failed to shift program dates');
        return;
      }

      // The same rows the function moved: this program, on or after fromDate,
      // not completed (a completed entry is the record of what happened on
      // that date), and a real YYYY-MM-DD, which the function leaves alone
      // rather than failing the shift. The server's count is the truth for
      // the toast; the local list may not hold every row it moved.
      const movesLocally = (fw: FutureWorkout) =>
        fw.programId === programId && fw.date >= fromDate && !fw.completed && isIsoDay(fw.date);
      setFutureWorkouts(prev => prev
        .map(fw => movesLocally(fw) ? { ...fw, date: shiftDate(fw.date) } : fw)
        .sort((a, b) => a.date.localeCompare(b.date)));
      setPrograms(prev => prev.map(p => p.id === programId ? shifted : p));
      toast.success(`Shifted ${moved} workout${moved === 1 ? '' : 's'} forward by ${days} day${days === 1 ? '' : 's'}`);
    } finally {
      shiftInFlight.current = false;
    }
  }, [user, programs]);

  const updatePreferences = useCallback(async (prefs: Partial<UserPreferences>) => {
    noteWrite();
    if (!user) return;
    // This upserts the whole settings row from local state. After a load that
    // failed with nothing cached, that state is DEFAULT_PREFERENCES, so writing
    // it would replace the user's real streak mode, target and unit with
    // placeholders — the finished form of the bug where a failed load cleared a
    // streak permanently.
    if (!snapshotTrusted) {
      toast.error("Your settings haven't loaded yet — try again in a moment.");
      return;
    }
    const previous = preferences;
    let updated = { ...preferences, ...prefs };

    // Streaks are forward-acting: a settings edit must not visibly change the
    // number on the home page. When the mode or target moves, freeze whatever
    // the user was seeing under the OLD settings as an offset, so raw + offset
    // = old_displayed on the day of the change. The offset then decays
    // naturally — see computeDisplayedStreak for the clear-on-break logic.
    // Callers should not set streakAdjustment/streakAdjustmentSetAt directly;
    // this branch reconciles them from the mode/target delta and any explicit
    // caller-supplied override (e.g. the auto-clear effect) takes precedence.
    const modeOrTargetChanging =
      prefs.streakMode !== undefined && prefs.streakMode !== previous.streakMode
      || prefs.streakWeeklyTarget !== undefined && prefs.streakWeeklyTarget !== previous.streakWeeklyTarget;
    const callerSetAdjustment = prefs.streakAdjustment !== undefined || prefs.streakAdjustmentSetAt !== undefined;
    if (modeOrTargetChanging && !callerSetAdjustment) {
      const today = format(new Date(), 'yyyy-MM-dd');
      const oldDisplayed = computeDisplayedStreak(
        history,
        previous.streakMode,
        previous.streakWeeklyTarget,
        previous.streakAdjustment,
        previous.streakAdjustmentSetAt,
      ).displayed;
      const newRaw = getCurrentStreak(history, updated.streakMode, updated.streakWeeklyTarget);
      updated = {
        ...updated,
        streakAdjustment: oldDisplayed - newRaw,
        streakAdjustmentSetAt: today,
      };
    }

    setPreferencesState(updated);
    // Only the columns that changed on this device are sent. An upsert with a
    // partial payload updates just those columns on conflict, so a phone and a
    // laptop no longer overwrite each other's newer values with whatever each
    // had cached — and active_program_id, which has its own write path, is not
    // dragged along. The streak-adjustment columns ride with any mode/target
    // change because the reconciliation above derives them from it.
    const changedKeys = new Set<keyof UserPreferences>(Object.keys(prefs) as (keyof UserPreferences)[]);
    if (modeOrTargetChanging) { changedKeys.add('streakAdjustment'); changedKeys.add('streakAdjustmentSetAt'); }
    const column: Record<keyof UserPreferences, keyof SettingsRow> = {
      weightUnit: 'weight_unit',
      defaultRestSeconds: 'default_rest_seconds',
      defaultDropSetsEnabled: 'default_drop_sets_enabled',
      streakMode: 'streak_mode',
      streakWeeklyTarget: 'streak_weekly_target',
      streakAdjustment: 'streak_adjustment',
      streakAdjustmentSetAt: 'streak_adjustment_set_at',
      tutorialCompleted: 'tutorial_completed',
      hideTimers: 'hide_timers',
      customLocations: 'custom_locations',
      stickyNotes: 'sticky_notes',
    };
    const payload: Record<string, unknown> = { user_id: user.id };
    for (const key of changedKeys) payload[column[key]] = updated[key];
    const { error } = await supabase.from('user_settings').upsert(
      payload as Database['public']['Tables']['user_settings']['Insert'],
      { onConflict: 'user_id' },
    );
    if (error) {
      console.error('[useStorage] updatePreferences error:', error);
      toast.error('Failed to save preferences');
      setPreferencesState(previous); // rollback
    }
  }, [user, preferences, history, snapshotTrusted]);

  // Once the new streak mode has produced an actual break (raw=0 for at
  // least one period past the day the adjustment was set), clear the
  // adjustment so a future re-started streak doesn't inherit the frozen
  // offset. The ref keeps us from re-firing while the write is in flight or
  // if history/preferences churn without the underlying signal changing.
  const clearedAdjustmentAt = useRef<string | null>(null);
  useEffect(() => {
    // loadedOk, not !loading: an empty `history` left by a failed sessions
    // query looks exactly like a broken streak, and this clears the
    // adjustment in the database on the strength of it.
    if (!user || !loadedOk) return;
    if (preferences.streakAdjustment === 0 && preferences.streakAdjustmentSetAt === null) return;
    const { shouldClearAdjustment } = computeDisplayedStreak(
      history,
      preferences.streakMode,
      preferences.streakWeeklyTarget,
      preferences.streakAdjustment,
      preferences.streakAdjustmentSetAt,
    );
    if (!shouldClearAdjustment) return;
    const key = preferences.streakAdjustmentSetAt ?? 'null';
    if (clearedAdjustmentAt.current === key) return;
    clearedAdjustmentAt.current = key;
    updatePreferences({ streakAdjustment: 0, streakAdjustmentSetAt: null });
  }, [user, loadedOk, history, preferences.streakMode, preferences.streakWeeklyTarget, preferences.streakAdjustment, preferences.streakAdjustmentSetAt, updatePreferences]);

  const updateProfile = useCallback(async (updates: Partial<UserProfile>) => {
    noteWrite();
    if (!user) return;
    // Same whole-row hazard as updatePreferences: DEFAULT_PROFILE would blank
    // goal, equipment, injuries, age, height and drop the subscription tier.
    if (!snapshotTrusted) {
      toast.error("Your profile hasn't loaded yet — try again in a moment.");
      return;
    }
    const merged = { ...profile, ...updates };
    // Hybrid sub-goals only apply when goal === 'hybrid'; wipe them otherwise
    // so a user toggling off hybrid doesn't leave a stale array behind.
    const updated: UserProfile = merged.goal === 'hybrid'
      ? merged
      : { ...merged, hybridGoals: [] };
    const previous = profile;
    setProfileState(updated);
    // Same partial-payload rule as updatePreferences: send what this call is
    // changing, not the whole cached row. hybrid_goals rides along whenever
    // the goal changes, since the merge above may have just cleared it.
    const profileColumn: Record<keyof UserProfile, keyof ProfileInsert> = {
      displayName: 'display_name', goal: 'goal', hybridGoals: 'hybrid_goals',
      coachNotes: 'coach_notes', experienceLevel: 'experience_level',
      equipment: 'equipment', injuries: 'injuries', age: 'age', sex: 'sex',
      heightCm: 'height_cm', subscriptionTier: 'subscription_tier',
    };
    const profileKeys = new Set<keyof UserProfile>(Object.keys(updates) as (keyof UserProfile)[]);
    if (profileKeys.has('goal')) profileKeys.add('hybridGoals');
    const profilePayload: ProfileInsert = { user_id: user.id };
    for (const key of profileKeys) (profilePayload as Record<string, unknown>)[profileColumn[key]] = updated[key];
    const { error } = await supabase
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'user_id' });
    if (error) {
      console.error('[useStorage] updateProfile error:', error);
      toast.error('Failed to save profile');
      setProfileState(previous); // rollback
    }
  }, [user, profile, snapshotTrusted]);

  const addBodyMeasurement = useCallback(async (weightKg: number, date?: string): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    const id = crypto.randomUUID();
    const dateStr = date || format(new Date(), 'yyyy-MM-dd');
    const newRow: BodyMeasurement = { id, date: dateStr, weightKg };
    const previous = bodyMeasurements;
    setBodyMeasurements(prev => [newRow, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
    const payload: BodyMeasurementInsert = { id, user_id: user.id, date: dateStr, weight_kg: weightKg };
    const { error } = await supabase.from('body_measurements').insert(payload);
    if (error) {
      console.error('[useStorage] addBodyMeasurement error:', error);
      toast.error('Failed to log bodyweight');
      setBodyMeasurements(previous);
      return false;
    }
    return true;
  }, [user, bodyMeasurements]);

  const deleteBodyMeasurement = useCallback(async (id: string): Promise<boolean> => {
    noteWrite();
    if (!user) return false;
    const previous = bodyMeasurements;
    setBodyMeasurements(prev => prev.filter(m => m.id !== id));
    const { error } = await supabase.from('body_measurements').delete().eq('id', id);
    if (error) {
      console.error('[useStorage] deleteBodyMeasurement error:', error);
      toast.error('Failed to delete measurement');
      setBodyMeasurements(previous);
      return false;
    }
    return true;
  }, [user, bodyMeasurements]);

  return {
    history, templates, programs, activeProgramId, futureWorkouts, preferences, profile, bodyMeasurements, loading, refreshing,
    // `loading` false does NOT mean the data is real — a failed load also ends
    // loading. Anything that acts on the data's *content* (starting the
    // tutorial because tutorialCompleted is false, say) must gate on this.
    dataTrusted: snapshotTrusted,
    saveSession, saveTemplate, deleteTemplate,
    saveProgram, deleteProgram, setActiveProgram, deleteSession, updateFutureWorkout,
    deleteFutureWorkout, pushProgramBack, updatePreferences,
    updateProfile, addBodyMeasurement, deleteBodyMeasurement,
  };
}
