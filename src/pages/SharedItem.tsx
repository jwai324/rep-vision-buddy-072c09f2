import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, LinkIcon, LogIn } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SessionSummary } from '@/components/SessionSummary';
import { SharedProgramView } from '@/components/shared/SharedProgramView';
import { SharedTemplateView } from '@/components/shared/SharedTemplateView';
import { importSharedSnapshot } from '@/utils/shareImport';
import { SHARE_SNAPSHOT_VERSION, type ShareSnapshot } from '@/types/share';
import type { WeightUnit } from '@/hooks/useStorage';

type LoadState =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'revoked' }
  | { status: 'unsupported' }
  | { status: 'ready'; title: string; snapshot: ShareSnapshot };

const Centered: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-background flex items-center justify-center p-6">
    <div className="text-center max-w-sm flex flex-col items-center gap-3">{children}</div>
  </div>
);

/**
 * Public, unauthenticated view of a shared workout, template, or program.
 *
 * Everything rendered comes out of the snapshot returned by `get_shared_item`
 * — this page never touches the sharer's tables, and it must not use
 * `useStorage` or any owner-scoped hook.
 */
const SharedItem: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!token) { setState({ status: 'missing' }); return; }
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.rpc('get_shared_item', { p_token: token });
      if (cancelled) return;
      if (error) {
        console.error('[SharedItem] rpc error:', error);
        setState({ status: 'missing' });
        return;
      }
      const row = data?.[0];
      if (!row) { setState({ status: 'missing' }); return; }
      if (row.revoked) { setState({ status: 'revoked' }); return; }

      const snapshot = row.payload as unknown as ShareSnapshot;
      if (!snapshot || snapshot.version > SHARE_SNAPSHOT_VERSION) {
        setState({ status: 'unsupported' });
        return;
      }
      setUnit(snapshot.weightUnit ?? 'kg');
      setState({ status: 'ready', title: row.title, snapshot });
    })();

    return () => { cancelled = true; };
  }, [token]);

  const handleImport = useCallback(async () => {
    if (state.status !== 'ready' || !user) return;
    setImporting(true);
    try {
      const result = await importSharedSnapshot(supabase, user.id, state.snapshot, state.title);
      const parts = [
        result.programsCreated ? `${result.programsCreated} program` : null,
        result.templatesCreated ? `${result.templatesCreated} template${result.templatesCreated === 1 ? '' : 's'}` : null,
        result.customExercisesCreated ? `${result.customExercisesCreated} exercise${result.customExercisesCreated === 1 ? '' : 's'}` : null,
      ].filter(Boolean);
      toast.success(`Saved ${parts.join(', ')} to your workouts`);
      navigate('/');
    } catch (err) {
      console.error('[SharedItem] import error:', err);
      toast.error('Could not save this to your workouts');
    } finally {
      setImporting(false);
    }
  }, [state, user, navigate]);

  if (state.status === 'loading') {
    return <Centered><p className="text-muted-foreground">Loading…</p></Centered>;
  }

  if (state.status === 'revoked') {
    return (
      <Centered>
        <LinkIcon className="w-8 h-8 text-muted-foreground" />
        <h1 className="text-xl font-extrabold text-foreground">This link is no longer available</h1>
        <p className="text-sm text-muted-foreground">The person who shared it has revoked access.</p>
        <Button asChild variant="outline"><Link to="/">Go to RepVision</Link></Button>
      </Centered>
    );
  }

  if (state.status === 'missing') {
    return (
      <Centered>
        <LinkIcon className="w-8 h-8 text-muted-foreground" />
        <h1 className="text-xl font-extrabold text-foreground">Link not found</h1>
        <p className="text-sm text-muted-foreground">Double-check the link, or ask for a new one.</p>
        <Button asChild variant="outline"><Link to="/">Go to RepVision</Link></Button>
      </Centered>
    );
  }

  if (state.status === 'unsupported') {
    return (
      <Centered>
        <LinkIcon className="w-8 h-8 text-muted-foreground" />
        <h1 className="text-xl font-extrabold text-foreground">Can't open this link</h1>
        <p className="text-sm text-muted-foreground">It was created by a newer version of RepVision. Try refreshing the page.</p>
      </Centered>
    );
  }

  const { snapshot, title } = state;
  const sharedBy = snapshot.sharedBy?.trim() || 'a RepVision user';
  const importable = snapshot.kind !== 'session' || snapshot.session.exercises.length > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto p-4 flex flex-col gap-4">
        <header className="flex items-center justify-between gap-3 pt-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">RepVision</p>
            <p className="text-xs text-muted-foreground truncate">Shared by {sharedBy}</p>
          </div>
          <div className="flex rounded-lg border border-border overflow-hidden shrink-0">
            {(['kg', 'lbs'] as WeightUnit[]).map(u => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                  unit === u ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </header>

        {/* A snapshot written by a different build shouldn't white-screen the page. */}
        <ErrorBoundary fallbackTitle="Couldn't display this">
          {snapshot.kind === 'session' && (
            <SessionSummary session={snapshot.session} weightUnit={unit} isViewMode />
          )}
          {snapshot.kind === 'template' && (
            <SharedTemplateView
              template={snapshot.template}
              exerciseMeta={snapshot.exerciseMeta}
              customExercises={snapshot.customExercises}
              unit={unit}
            />
          )}
          {snapshot.kind === 'program' && (
            <SharedProgramView
              program={snapshot.program}
              templates={snapshot.templates}
              exerciseMeta={snapshot.exerciseMeta}
              customExercises={snapshot.customExercises}
              unit={unit}
            />
          )}
        </ErrorBoundary>

        {importable && !authLoading && (
          user ? (
            <Button variant="neon" onClick={handleImport} disabled={importing} className="w-full gap-2">
              <Download className="w-4 h-4" />
              {importing
                ? 'Saving…'
                : snapshot.kind === 'session' ? 'Save as template' : 'Save to my workouts'}
            </Button>
          ) : (
            <Button asChild variant="neon" className="w-full gap-2">
              <Link to={`/auth?next=${encodeURIComponent(`/s/${token}`)}`}>
                <LogIn className="w-4 h-4" />
                Sign in to save
              </Link>
            </Button>
          )
        )}

        <p className="text-[10px] text-center text-muted-foreground pb-4">
          A copy of "{title}" taken when it was shared.
        </p>
      </div>
    </div>
  );
};

export default SharedItem;
