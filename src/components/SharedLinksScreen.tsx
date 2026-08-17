import React, { useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { CalendarDays, ChevronLeft, Copy, Dumbbell, ExternalLink, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { shareUrlFor, useShares } from '@/hooks/useShares';
import type { ShareKind, ShareListItem } from '@/types/share';

interface SharedLinksScreenProps {
  onBack: () => void;
}

const KIND_LABEL: Record<ShareKind, string> = {
  session: 'Workout',
  template: 'Template',
  program: 'Program',
};

const KindIcon: React.FC<{ kind: ShareKind }> = ({ kind }) => {
  const className = 'w-4 h-4 text-primary';
  if (kind === 'program') return <CalendarDays className={className} />;
  if (kind === 'template') return <Layers className={className} />;
  return <Dumbbell className={className} />;
};

export const SharedLinksScreen: React.FC<SharedLinksScreenProps> = ({ onBack }) => {
  const { shares, loading, revokeShare } = useShares();
  const [revokeTarget, setRevokeTarget] = useState<ShareListItem | null>(null);

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrlFor(token));
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-extrabold text-foreground">Shared Links</h2>
      </div>

      <p className="text-xs text-muted-foreground">
        Each link shows a copy taken when you shared it. Revoking is the only way to
        cut off access — deleting the original workout does not.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : shares.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>You haven't shared anything yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {shares.map(share => {
            const revoked = !!share.revokedAt;
            return (
              <div
                key={share.id}
                className={`bg-card rounded-xl p-4 border border-border ${revoked ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <KindIcon kind={share.kind} />
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                    {KIND_LABEL[share.kind]}
                  </span>
                  {revoked && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                      Revoked
                    </span>
                  )}
                </div>
                <h3 className={`font-semibold text-foreground mb-1 ${revoked ? 'line-through' : ''}`}>
                  {share.title}
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Shared {format(new Date(share.createdAt), 'MMM d, yyyy')} · {share.viewCount}{' '}
                  {share.viewCount === 1 ? 'view' : 'views'}
                </p>

                {!revoked && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => copy(share.token)} className="gap-1.5">
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </Button>
                    <Button variant="ghost" size="sm" asChild className="gap-1.5">
                      <a href={shareUrlFor(share.token)} target="_blank" rel="noreferrer">
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRevokeTarget(share)}
                      className="text-set-failure"
                    >
                      Revoke
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!revokeTarget} onOpenChange={open => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this link?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone holding the link to "{revokeTarget?.title}" will lose access immediately.
              This can't be undone, but you can share it again to get a new link.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revokeTarget) revokeShare(revokeTarget.id);
                setRevokeTarget(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
