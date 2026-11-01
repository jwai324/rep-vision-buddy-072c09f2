import React, { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { ChevronLeft, ClipboardList, Copy, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCoach, type CoachClient } from '@/contexts/CoachContext';
import {
  endCoachLink, formatInviteCode, normaliseInviteCode, redeemCoachInvite, useCoachLinks,
  type MyCoach,
} from '@/hooks/useCoachLinks';
import { describeActivity } from '@/utils/coachActivity';

interface CoachingScreenProps {
  onBack: () => void;
  onOpenClient: (client: { clientId: string; displayName: string | null }) => void;
}

const INVITE_CODE_LENGTH = 10;

const destructiveAction = 'bg-destructive text-destructive-foreground hover:bg-destructive/90';

const sinceLabel = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : format(date, 'MMM d, yyyy');
};

const relativeTime = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : formatDistanceToNow(date, { addSuffix: true });
};

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 mb-2">
    {icon}
    <h3 className="font-bold text-foreground">{children}</h3>
  </div>
);

const ClientsSection: React.FC<{ onOpenClient: CoachingScreenProps['onOpenClient'] }> = ({ onOpenClient }) => {
  const { clients, clientsLoaded, refreshClients } = useCoach();
  const [code, setCode] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [stopTarget, setStopTarget] = useState<CoachClient | null>(null);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (redeeming) return;
    const clean = normaliseInviteCode(code);
    if (clean.length !== INVITE_CODE_LENGTH) {
      setRedeemError(`Invite codes are ${INVITE_CODE_LENGTH} characters.`);
      return;
    }
    setRedeeming(true);
    setRedeemError(null);
    const result = await redeemCoachInvite(clean);
    setRedeeming(false);
    // `in` rather than `!result.ok`: without strictNullChecks a boolean
    // discriminant does not narrow the union.
    if ('message' in result) {
      setRedeemError(result.message);
      return;
    }
    setCode('');
    toast.success(`You're now coaching ${result.clientName ?? 'a new client'}`);
    await refreshClients();
  };

  const stopCoaching = async (client: CoachClient) => {
    const name = client.displayName ?? 'this client';
    const ok = await endCoachLink(client.linkId);
    if (ok) toast.success(`You've stopped coaching ${name}`);
    else toast.error(`Couldn't stop coaching ${name}. Try again.`);
    await refreshClients();
  };

  return (
    <section className="bg-card rounded-xl p-4 border border-border" aria-labelledby="coaching-clients">
      <SectionTitle icon={<Users className="w-4 h-4 text-primary" />}>
        <span id="coaching-clients">Your clients</span>
      </SectionTitle>

      <form onSubmit={connect} className="flex flex-col gap-2 mb-4">
        <label htmlFor="coach-invite-code" className="text-xs text-muted-foreground">
          Enter a client's code
        </label>
        <div className="flex gap-2">
          <Input
            id="coach-invite-code"
            value={code}
            onChange={e => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9\- ]/g, ''));
              setRedeemError(null);
            }}
            placeholder="ABCDE-FGHJK"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
            className="font-mono tracking-widest uppercase"
          />
          <Button type="submit" disabled={redeeming || normaliseInviteCode(code).length === 0}>
            {redeeming ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
        {redeemError && (
          <p role="alert" className="text-xs text-destructive font-medium">{redeemError}</p>
        )}
      </form>

      {!clientsLoaded ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : clients.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You aren't coaching anyone yet. Ask your client to create an invite code in Settings → Coaching.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {clients.map(client => (
            <li key={client.linkId} className="flex flex-wrap items-center gap-2 rounded-lg bg-secondary/50 p-3">
              <div className="min-w-0 flex-1 basis-32">
                <p className="font-semibold text-foreground truncate">{client.displayName ?? 'Unnamed client'}</p>
                <p className="text-xs text-muted-foreground">Since {sinceLabel(client.linkedAt)}</p>
              </div>
              <Button
                size="sm"
                onClick={() => onOpenClient({ clientId: client.clientId, displayName: client.displayName })}
              >
                Open
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-set-failure px-2"
                onClick={() => setStopTarget(client)}
              >
                Stop coaching
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!stopTarget} onOpenChange={open => !open && setStopTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop coaching {stopTarget?.displayName ?? 'this client'}?</AlertDialogTitle>
            <AlertDialogDescription>
              You'll lose access to their account immediately. They can invite you again with a new code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={destructiveAction}
              onClick={() => {
                if (stopTarget) void stopCoaching(stopTarget);
                setStopTarget(null);
              }}
            >
              Stop coaching
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

type CoachLinks = ReturnType<typeof useCoachLinks>;

const CoachesSection: React.FC<{ links: CoachLinks }> = ({ links }) => {
  const {
    invite, inviteLoading, inviteError, inviteBusy, createInvite, cancelInvite, reloadInvite,
    coaches, coachesLoading, coachesError, removeCoach,
  } = links;
  const [removeTarget, setRemoveTarget] = useState<MyCoach | null>(null);

  // A code that ran out while the screen was open is no longer usable.
  const liveInvite = invite && new Date(invite.expiresAt).getTime() > Date.now() ? invite : null;

  const mint = async () => {
    const ok = await createInvite();
    if (!ok) toast.error("Couldn't create an invite code. Try again.");
  };

  const cancel = async () => {
    const ok = await cancelInvite();
    if (ok) toast.success('Invite code cancelled');
    else toast.error("Couldn't cancel that code. It may already have been used.");
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Code copied');
    } catch {
      toast.error('Could not copy the code');
    }
  };

  const remove = async (coach: MyCoach) => {
    const name = coach.displayName ?? 'your coach';
    const ok = await removeCoach(coach.linkId);
    if (ok) toast.success(`Removed ${name}`);
    else toast.error(`Couldn't remove ${name}. Try again.`);
  };

  return (
    <section className="bg-card rounded-xl p-4 border border-border" aria-labelledby="coaching-coaches">
      <SectionTitle icon={<UserPlus className="w-4 h-4 text-primary" />}>
        <span id="coaching-coaches">Your coaches</span>
      </SectionTitle>

      <p className="text-xs text-muted-foreground mb-3">
        A coach can view and edit your profile, settings, programs, templates, schedule, workout history
        and bodyweight. They can't see your credits or share links. Everything they change is listed under
        Coach activity.
      </p>

      <div className="mb-4">
        {inviteLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : liveInvite ? (
          <div className="rounded-lg bg-secondary/50 p-3 flex flex-col items-center gap-1 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Invite code</p>
            <p
              className="font-mono text-3xl font-bold tracking-widest text-foreground select-all"
              data-testid="coach-invite-code"
            >
              {formatInviteCode(liveInvite.code)}
            </p>
            <p className="text-xs text-muted-foreground">
              Expires in {formatDistanceToNow(new Date(liveInvite.expiresAt))} · works once
            </p>
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => copy(formatInviteCode(liveInvite.code))}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy
              </Button>
              <Button variant="ghost" size="sm" disabled={inviteBusy} onClick={cancel} className="text-set-failure">
                Cancel code
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {inviteError && (
              <p className="text-xs text-destructive">
                Couldn't check for an existing code.{' '}
                <button type="button" className="underline" onClick={() => void reloadInvite()}>Retry</button>
              </p>
            )}
            <Button onClick={mint} disabled={inviteBusy} className="gap-1.5 self-start">
              <UserPlus className="w-4 h-4" />
              {inviteBusy ? 'Creating…' : 'Invite a coach'}
            </Button>
          </div>
        )}
      </div>

      {coachesLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : coachesError ? (
        <p className="text-sm text-destructive">Couldn't load your coaches.</p>
      ) : coaches.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one is coaching you.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {coaches.map(coach => (
            <li key={coach.linkId} className="flex items-center gap-2 rounded-lg bg-secondary/50 p-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground truncate">{coach.displayName ?? 'Unnamed coach'}</p>
                <p className="text-xs text-muted-foreground">Since {sinceLabel(coach.linkedAt)}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-set-failure"
                onClick={() => setRemoveTarget(coach)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={open => !open && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.displayName ?? 'this coach'}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will lose access to your account immediately. What they already changed stays as it is,
              and stays listed under Coach activity.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={destructiveAction}
              onClick={() => {
                if (removeTarget) void remove(removeTarget);
                setRemoveTarget(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

const ActivitySection: React.FC<{ links: CoachLinks }> = ({ links }) => {
  const { activity, activityLoading, activityError, activityHasMore, loadMoreActivity, refreshActivity } = links;
  const initialLoad = activityLoading && activity.length === 0;

  return (
    <section className="bg-card rounded-xl p-4 border border-border" aria-labelledby="coaching-activity">
      <SectionTitle icon={<ClipboardList className="w-4 h-4 text-primary" />}>
        <span id="coaching-activity">Coach activity</span>
      </SectionTitle>

      {initialLoad ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : activityError && activity.length === 0 ? (
        <p className="text-sm text-destructive">
          Couldn't load coach activity.{' '}
          <button type="button" className="underline" onClick={() => void refreshActivity()}>Retry</button>
        </p>
      ) : activity.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Anything a coach changes in your account will be listed here.
        </p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {activity.map(row => {
              const { headline, detail } = describeActivity(row);
              return (
                <li key={row.id} className="py-2.5 first:pt-0">
                  <p className="text-sm font-medium text-foreground">{headline}</p>
                  {detail && <p className="text-xs text-muted-foreground break-words">{detail}</p>}
                  <p className="text-[11px] text-muted-foreground">{relativeTime(row.created_at)}</p>
                </li>
              );
            })}
          </ul>
          {activityError && (
            <p className="text-xs text-destructive mt-2">Couldn't load more activity.</p>
          )}
          {activityHasMore && (
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-3"
              disabled={activityLoading}
              onClick={() => void loadMoreActivity()}
            >
              {activityLoading ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </section>
  );
};

export const CoachingScreen: React.FC<CoachingScreenProps> = ({ onBack, onOpenClient }) => {
  const links = useCoachLinks();

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-extrabold text-foreground">Coaching</h2>
      </div>

      <ClientsSection onOpenClient={onOpenClient} />
      <CoachesSection links={links} />
      <ActivitySection links={links} />
    </div>
  );
};
