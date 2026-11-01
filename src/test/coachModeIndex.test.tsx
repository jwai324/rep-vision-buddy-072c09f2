import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

// Index while a coach acts as a client: which workout bar shows, which of the
// coach's own surfaces (share links, credits, backups, sign-out) are out of
// reach, and what Settings offers instead. Everything Index renders is real
// except the dashboard and the chat bubble, which are stubbed to record the
// props Index hands them, and the data layer, which is a fixed object.

interface CoachClient { linkId: string; clientId: string; displayName: string | null; linkedAt: string }
interface CoachValue {
  authUserId: string | null;
  ownerId: string | null;
  actingAs: { clientId: string; displayName: string | null } | null;
  clients: CoachClient[];
  clientsLoaded: boolean;
  ownTier: 'free' | 'premium' | null;
  refreshClients: () => Promise<void>;
  actAs: (client: { clientId: string; displayName: string | null }) => boolean;
  stopActing: () => boolean;
  accessLost: (clientId: string) => void;
}

type Props = Record<string, unknown>;

const hoisted = vi.hoisted(() => ({
  coach: null as unknown as CoachValue,
  storage: null as unknown as Record<string, unknown>,
  dashboardProps: null as Record<string, unknown> | null,
  chatBubbleProps: null as Record<string, unknown> | null,
  toastError: vi.fn(),
  signOut: vi.fn(),
  tutorialStart: vi.fn(),
  tutorialOnComplete: null as (() => void) | null,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: hoisted.toastError, info: vi.fn() }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    rpc: async () => ({ data: null, error: null }),
  },
}));

vi.mock('@/hooks/useStorage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useStorage')>()),
  useStorage: () => hoisted.storage,
}));

vi.mock('@/contexts/CoachContext', () => ({
  useCoach: () => hoisted.coach,
  useOwnerDraftKey: (base: string) => base,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'coach-1', email: 'carol@example.com' },
    session: null,
    loading: false,
    signOut: hoisted.signOut,
  }),
}));

vi.mock('@/contexts/ChatContext', () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useChatContext: () => ({ registerScreen: () => {} }),
}));

vi.mock('@/contexts/CustomExercisesContext', () => ({
  CustomExercisesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useCustomExercisesContext: () => ({
    exercises: [], loading: false,
    addExercise: vi.fn(), deleteExercise: vi.fn(), updateExercise: vi.fn(),
  }),
}));

vi.mock('@/contexts/TutorialContext', () => ({
  TutorialProvider: ({ children, onComplete }: { children: React.ReactNode; onComplete: () => void }) => {
    hoisted.tutorialOnComplete = onComplete;
    return <>{children}</>;
  },
  useTutorial: () => ({
    active: false, steps: [], index: 0,
    start: hoisted.tutorialStart, next: vi.fn(), prev: vi.fn(), skip: vi.fn(), stop: vi.fn(),
    goToScreenSteps: vi.fn(), setScreenBackHandler: vi.fn(),
  }),
}));

vi.mock('@/components/TutorialOverlay', () => ({ TutorialOverlay: () => null }));
vi.mock('@/components/ErrorReportButton', () => ({ ErrorReportButton: () => null }));

vi.mock('@/components/AIChatBubble', () => ({
  AIChatBubble: (props: Props) => {
    hoisted.chatBubbleProps = props;
    return null;
  },
}));

vi.mock('@/components/Dashboard', () => ({
  Dashboard: (props: Props) => {
    hoisted.dashboardProps = props;
    return <h1>Dashboard stub</h1>;
  },
}));

import Index from '@/pages/Index';
import { TemplatesScreen } from '@/components/TemplatesScreen';
import { ProgramsScreen } from '@/components/ProgramsScreen';
import { DEFAULT_PREFERENCES } from '@/hooks/useStorage';
import { ACTIVE_SESSION_CACHE_KEY } from '@/utils/localDrafts';
import type { ActiveSessionCache } from '@/types/activeSession';
import type { WorkoutProgram, WorkoutTemplate } from '@/types/workout';

const COACH = 'coach-1';
const ALICE = 'client-alice';
const BOB = 'client-bob';

const PUSH: WorkoutTemplate = {
  id: 'tpl-push',
  name: 'Push',
  exercises: [{ exerciseId: 'flat-barbell-bench-press', sets: 3, targetReps: 10, setType: 'normal', restSeconds: 90 }],
};
const PPL: WorkoutProgram = { id: 'prog-ppl', name: 'PPL', days: [{ label: 'Day 1', templateId: PUSH.id }] };

const client = (clientId: string, displayName: string | null): CoachClient =>
  ({ linkId: `link-${clientId}`, clientId, displayName, linkedAt: '2026-10-01T00:00:00Z' });
const CLIENTS = [client(ALICE, 'Alice'), client(BOB, 'Bob')];

const coachValue = (over: Partial<CoachValue> = {}): CoachValue => ({
  authUserId: COACH,
  ownerId: COACH,
  actingAs: null,
  clients: CLIENTS,
  clientsLoaded: true,
  ownTier: 'premium',
  refreshClients: vi.fn(async () => {}),
  actAs: vi.fn(() => true),
  stopActing: vi.fn(() => true),
  accessLost: vi.fn(),
  ...over,
});
const ownAccount = (over: Partial<CoachValue> = {}) => coachValue(over);
const actingFor = (clientId: string, displayName: string | null, over: Partial<CoachValue> = {}) =>
  coachValue({ ownerId: clientId, actingAs: { clientId, displayName }, ...over });

const makeStorage = (over: Record<string, unknown> = {}) => ({
  loading: false,
  refreshing: false,
  dataTrusted: true,
  history: [],
  templates: [PUSH],
  programs: [PPL],
  futureWorkouts: [],
  bodyMeasurements: [],
  activeProgramId: null,
  preferences: { ...DEFAULT_PREFERENCES, tutorialCompleted: true },
  profile: {
    displayName: null, goal: null, hybridGoals: [], coachNotes: null, experienceLevel: null,
    equipment: [], injuries: [], age: null, sex: null, heightCm: null, subscriptionTier: 'premium',
  },
  saveTemplate: vi.fn(async () => true),
  deleteTemplate: vi.fn(async () => true),
  saveSession: vi.fn(async () => true),
  deleteSession: vi.fn(async () => true),
  saveProgram: vi.fn(async () => true),
  deleteProgram: vi.fn(async () => true),
  setActiveProgram: vi.fn(async () => true),
  updatePreferences: vi.fn(),
  updateProfile: vi.fn(),
  addBodyMeasurement: vi.fn(),
  deleteBodyMeasurement: vi.fn(),
  updateFutureWorkout: vi.fn(),
  deleteFutureWorkout: vi.fn(),
  pushProgramBack: vi.fn(async () => true),
  ...over,
});

const writeCache = (over: Partial<ActiveSessionCache> = {}) => {
  const cache: ActiveSessionCache = {
    blocks: [{
      exerciseId: 'barbell-back-squat',
      exerciseName: 'Barbell Back Squat',
      restSeconds: 90,
      sets: [{ setNumber: 1, weight: '100', reps: '5', completed: false, type: 'normal', rpe: '', time: '' }],
    }],
    workoutName: 'Leg Day',
    startTimestamp: Date.now() - 60_000,
    trueStartTimestamp: Date.now() - 60_000,
    elapsedAtCache: 60,
    templateId: 'tpl-legs',
    ...over,
  };
  localStorage.setItem(ACTIVE_SESSION_CACHE_KEY, JSON.stringify(cache));
};
const readCache = (): ActiveSessionCache | null => {
  const raw = localStorage.getItem(ACTIVE_SESSION_CACHE_KEY);
  return raw ? (JSON.parse(raw) as ActiveSessionCache) : null;
};

const renderIndex = (coach: CoachValue, storage = makeStorage()) => {
  hoisted.coach = coach;
  hoisted.storage = storage;
  return render(<Index />);
};

/** The sidebar renders in jsdom (its `lg:` visibility is CSS only), which makes it the simplest way between screens. */
const goTo = (label: 'Templates' | 'Programs' | 'Settings') => {
  fireEvent.click(screen.getByRole('button', { name: label }));
};

// Index resets the scroll position on every screen change; jsdom has no layout to scroll.
window.scrollTo = (() => {}) as typeof window.scrollTo;

const minimizedBarShown = () => screen.queryByRole('button', { name: 'Resume' }) !== null;
const foreignBarFor = (ownerName: string) => screen.queryByText(`for ${ownerName}`);

beforeEach(() => {
  localStorage.clear();
  hoisted.dashboardProps = null;
  hoisted.chatBubbleProps = null;
  hoisted.toastError.mockReset();
  hoisted.signOut.mockReset();
  hoisted.tutorialStart.mockReset();
  hoisted.tutorialOnComplete = null;
});

describe('a workout in progress for another account', () => {
  it("is not resumable on the coach's own account; the foreign bar offers the switch instead", () => {
    writeCache({ ownerUserId: ALICE });
    const coach = ownAccount();
    renderIndex(coach);

    expect(minimizedBarShown()).toBe(false);
    expect(screen.getByText('Leg Day in progress')).toBeInTheDocument();
    expect(foreignBarFor('Alice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
    // The dashboard's own Start/Resume must not treat it as this account's.
    expect(hoisted.dashboardProps?.hasActiveWorkout).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(coach.actAs).toHaveBeenCalledWith({ clientId: ALICE, displayName: 'Alice' });
  });

  it('is the ordinary minimized bar while acting as the client who owns it', () => {
    writeCache({ ownerUserId: ALICE });
    renderIndex(actingFor(ALICE, 'Alice'));

    expect(minimizedBarShown()).toBe(true);
    expect(screen.queryByText(/^for /)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch' })).toBeNull();
    expect(hoisted.dashboardProps?.hasActiveWorkout).toBe(true);
  });

  it("treats a cache from before coach mode as the coach's own, and offers the way back to it", () => {
    writeCache();
    const coach = actingFor(ALICE, 'Alice');
    renderIndex(coach);

    expect(minimizedBarShown()).toBe(false);
    expect(foreignBarFor('your own account')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(coach.stopActing).toHaveBeenCalledTimes(1);
    expect(coach.actAs).not.toHaveBeenCalled();
  });

  it('names and switches to the other client while acting for a different one', () => {
    writeCache({ ownerUserId: BOB });
    const coach = actingFor(ALICE, 'Alice');
    renderIndex(coach);

    expect(minimizedBarShown()).toBe(false);
    expect(foreignBarFor('Bob')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(coach.actAs).toHaveBeenCalledWith({ clientId: BOB, displayName: 'Bob' });
  });

  it('still offers the switch before the client list has loaded', () => {
    writeCache({ ownerUserId: ALICE });
    renderIndex(ownAccount({ clients: [], clientsLoaded: false }));

    expect(foreignBarFor('your client')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
  });

  it("can be kept in the coach's own history once its owner is out of reach for good", () => {
    writeCache({ ownerUserId: 'client-gone' });
    renderIndex(ownAccount());

    expect(minimizedBarShown()).toBe(false);
    expect(screen.queryByRole('button', { name: 'Switch' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(readCache()?.ownerUserId).toBe(COACH);
    expect(readCache()?.workoutName).toBe('Leg Day');
    expect(minimizedBarShown()).toBe(true);
    expect(screen.queryByText(/^for /)).toBeNull();
  });

  it("is not kept into a client's account: Keep is offered only on the coach's own, and Switch leads there", () => {
    writeCache({ ownerUserId: 'client-gone' });
    const coach = actingFor(ALICE, 'Alice');
    renderIndex(coach);

    expect(screen.getByText('Leg Day in progress')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(coach.stopActing).toHaveBeenCalled();
  });

  it('is discarded only after the confirm', async () => {
    writeCache({ ownerUserId: ALICE });
    renderIndex(ownAccount());

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('The workout in progress for Alice will be lost.');
    expect(readCache()).not.toBeNull();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    expect(readCache()).toBeNull();
    expect(screen.queryByText('Leg Day in progress')).toBeNull();
  });

  it('blocks starting another workout on this device until it is dealt with', () => {
    writeCache({ ownerUserId: ALICE });
    renderIndex(ownAccount());

    goTo('Templates');
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(hoisted.toastError).toHaveBeenCalledWith(
      'A workout for Alice is still in progress on this device. Switch to it or discard it first.',
    );
    // Still on the list, and the other account's workout is untouched.
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(readCache()?.ownerUserId).toBe(ALICE);
    expect(readCache()?.workoutName).toBe('Leg Day');
  });
});

describe('share links while acting as a client', () => {
  it('are not offered on the templates or programs screens', () => {
    renderIndex(actingFor(ALICE, 'Alice'));

    goTo('Templates');
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share Push' })).toBeNull();

    goTo('Programs');
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share PPL' })).toBeNull();
  });

  it("are offered on the coach's own account", () => {
    renderIndex(ownAccount());

    goTo('Templates');
    expect(screen.getByRole('button', { name: 'Share Push' })).toBeInTheDocument();

    goTo('Programs');
    expect(screen.getByRole('button', { name: 'Share PPL' })).toBeInTheDocument();
  });

  it('leave no share button on either list when onShare is absent', () => {
    const { unmount } = render(
      <TemplatesScreen
        templates={[PUSH]} onDelete={vi.fn()} onStart={vi.fn()} onEdit={vi.fn()}
        onDuplicate={vi.fn()} onCreate={vi.fn()} onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Share / })).toBeNull();
    unmount();

    render(
      <ProgramsScreen
        programs={[PPL]} templates={[PUSH]} activeProgramId={null} onSetActive={vi.fn()}
        onView={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onCreate={vi.fn()} onBack={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Share / })).toBeNull();
  });
});

describe('Settings while acting as a client', () => {
  it("hides the coach's email, backups, credits and sign-out, and offers Exit coaching", () => {
    const coach = actingFor(ALICE, 'Alice');
    renderIndex(coach);
    goTo('Settings');

    expect(screen.getByText("You're editing Alice's settings. Changes apply to their app.")).toBeInTheDocument();
    // A client with no display name is shown by the link's name, never the coach's email prefix.
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('carol@example.com')).toBeNull();
    expect(screen.queryByText('carol')).toBeNull();
    expect(screen.queryByText('Data Management')).toBeNull();
    expect(screen.queryByText('Subscription & Credits')).toBeNull();
    expect(screen.queryByText('Shared Links')).toBeNull();
    expect(screen.queryByText('Coaching')).toBeNull();
    expect(screen.queryByText('Replay Tutorial')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign Out' })).toBeNull();
    // The client's own preferences stay editable.
    expect(screen.getByText('Coach Profile')).toBeInTheDocument();
    expect(screen.getByText('My Exercises')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Exit coaching' }));
    expect(coach.stopActing).toHaveBeenCalledTimes(1);
    expect(hoisted.signOut).not.toHaveBeenCalled();
    expect(screen.getByText('Dashboard stub')).toBeInTheDocument();
  });

  it('stays on Settings when the switch is refused (a workout in progress)', () => {
    const coach = actingFor(ALICE, 'Alice', { stopActing: vi.fn(() => false) });
    renderIndex(coach);
    goTo('Settings');

    fireEvent.click(screen.getByRole('button', { name: 'Exit coaching' }));
    expect(coach.stopActing).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Exit coaching' })).toBeInTheDocument();
    expect(screen.queryByText('Dashboard stub')).toBeNull();
  });

  it("shows all of them on the coach's own account, and no Exit coaching", () => {
    renderIndex(ownAccount());
    goTo('Settings');

    expect(screen.getByText('carol@example.com')).toBeInTheDocument();
    expect(screen.getByText('Data Management')).toBeInTheDocument();
    expect(screen.getByText('Subscription & Credits')).toBeInTheDocument();
    expect(screen.getByText('Shared Links')).toBeInTheDocument();
    expect(screen.getByText('Coaching')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exit coaching' })).toBeNull();
    expect(screen.queryByText(/You're editing/)).toBeNull();
  });
});

describe("the coach's own surfaces while acting", () => {
  it('shows the coaching banner, whose Exit goes back to the coach\'s account', () => {
    const coach = actingFor(ALICE, 'Alice');
    renderIndex(coach);

    expect(screen.getByRole('status')).toHaveTextContent('Coaching Alice');
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(coach.stopActing).toHaveBeenCalledTimes(1);
  });

  it("shows no banner on the coach's own account", () => {
    renderIndex(ownAccount());
    expect(screen.queryByText(/^Coaching /)).toBeNull();
  });

  it('takes the credits link out of the chat bubble', () => {
    renderIndex(actingFor(ALICE, 'Alice'));
    expect(hoisted.chatBubbleProps).not.toBeNull();
    expect(hoisted.chatBubbleProps?.onOpenCredits).toBeUndefined();
  });

  it("keeps the credits link in the chat bubble on the coach's own account", () => {
    renderIndex(ownAccount());
    expect(typeof hoisted.chatBubbleProps?.onOpenCredits).toBe('function');
  });

  it('offers the dashboard shortcut to clients only on the coach\'s own account, and only with clients', () => {
    const own = renderIndex(ownAccount());
    expect(typeof hoisted.dashboardProps?.onGoToCoaching).toBe('function');
    own.unmount();

    const none = renderIndex(ownAccount({ clients: [] }));
    expect(hoisted.dashboardProps?.onGoToCoaching).toBeUndefined();
    none.unmount();

    renderIndex(actingFor(ALICE, 'Alice'));
    expect(hoisted.dashboardProps?.onGoToCoaching).toBeUndefined();
  });

  it("names the client while their data loads", () => {
    renderIndex(actingFor(ALICE, 'Alice'), makeStorage({ loading: true }));
    expect(screen.getByText("Loading Alice's data…")).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Coaching Alice');
  });

  it("neither starts the tour nor marks it done in a client's settings", () => {
    const storage = makeStorage({ preferences: { ...DEFAULT_PREFERENCES, tutorialCompleted: false } });
    renderIndex(actingFor(ALICE, 'Alice'), storage);
    expect(hoisted.tutorialStart).not.toHaveBeenCalled();

    act(() => { hoisted.tutorialOnComplete?.(); });
    expect(storage.updatePreferences).not.toHaveBeenCalled();
  });

  it("starts the tour and records it on the coach's own account", () => {
    const storage = makeStorage({ preferences: { ...DEFAULT_PREFERENCES, tutorialCompleted: false } });
    renderIndex(ownAccount(), storage);
    expect(hoisted.tutorialStart).toHaveBeenCalledTimes(1);

    act(() => { hoisted.tutorialOnComplete?.(); });
    expect(storage.updatePreferences).toHaveBeenCalledWith({ tutorialCompleted: true });
  });
});
