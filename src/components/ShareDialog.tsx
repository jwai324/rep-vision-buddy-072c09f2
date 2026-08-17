import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Link2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { shareUrlFor, useShares } from '@/hooks/useShares';
import type { ShareKind, ShareSnapshot } from '@/types/share';

export interface ShareTarget {
  kind: ShareKind;
  sourceId: string;
  title: string;
  /** Built lazily so a snapshot is only assembled when the user actually shares. */
  buildPayload: () => ShareSnapshot;
}

interface ShareDialogProps {
  target: ShareTarget | null;
  onClose: () => void;
}

const KIND_NOUN: Record<ShareKind, string> = {
  session: 'workout',
  template: 'template',
  program: 'program',
};

async function copyToClipboard(url: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // navigator.clipboard needs a secure context. Fall back to the old
    // selection-based copy so this still works over plain http on a LAN.
    if (!input) return false;
    input.select();
    input.setSelectionRange(0, url.length);
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export const ShareDialog: React.FC<ShareDialogProps> = ({ target, onClose }) => {
  const { createOrUpdateShare, findLiveShare } = useShares({ autoFetch: false });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const kind = target?.kind ?? 'template';
  const sourceId = target?.sourceId ?? null;

  useEffect(() => {
    if (!target || !sourceId) { setUrl(null); return; }
    let cancelled = false;
    setUrl(null);
    setCopied(false);
    setChecking(true);
    findLiveShare(kind, sourceId).then(token => {
      if (cancelled) return;
      setUrl(token ? shareUrlFor(token) : null);
      setChecking(false);
    });
    return () => { cancelled = true; };
  }, [target, kind, sourceId, findLiveShare]);

  const publish = useCallback(async () => {
    if (!target) return;
    setBusy(true);
    const token = await createOrUpdateShare({
      kind: target.kind,
      sourceId: target.sourceId,
      title: target.title,
      payload: target.buildPayload(),
    });
    setBusy(false);
    if (!token) return;
    setUrl(shareUrlFor(token));
    toast.success(url ? 'Shared copy updated' : 'Link created');
  }, [target, createOrUpdateShare, url]);

  const handleCopy = useCallback(async () => {
    if (!url) return;
    const ok = await copyToClipboard(url, inputRef.current);
    if (!ok) { toast.error('Could not copy — select the link and copy it manually'); return; }
    setCopied(true);
    toast.success('Link copied');
    setTimeout(() => setCopied(false), 2000);
  }, [url]);

  // Called straight from the click handler with no await in front of it:
  // navigator.share needs transient user activation, and awaiting the share
  // creation first would consume it and make the sheet silently fail.
  const handleNativeShare = useCallback(() => {
    if (!url || !target) return;
    navigator.share({ title: target.title, url }).catch(() => { /* user dismissed */ });
  }, [url, target]);

  const noun = KIND_NOUN[kind];
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <AlertDialog open={!!target} onOpenChange={open => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4" />
            Share {noun}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {url
              ? `Anyone with this link can view "${target?.title}". It shows a copy taken when you shared it, so later edits stay private until you update it.`
              : `Creates a public link to a snapshot of "${target?.title}". Anyone with the link can view it — and save it to their own workouts.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {url && (
          <div className="flex flex-col gap-2">
            <Input ref={inputRef} readOnly value={url} onFocus={e => e.currentTarget.select()} className="text-xs" />
            <div className="flex gap-2">
              <Button variant="neon" onClick={handleCopy} className="flex-1 gap-2">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              {canNativeShare && (
                <Button variant="outline" onClick={handleNativeShare} className="flex-1 gap-2">
                  <Share2 className="w-4 h-4" />
                  Share
                </Button>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={publish} disabled={busy} className="w-full">
              {busy ? 'Updating…' : 'Update shared copy'}
            </Button>
          </div>
        )}

        {!url && !checking && (
          <Button variant="neon" onClick={publish} disabled={busy} className="w-full gap-2">
            <Link2 className="w-4 h-4" />
            {busy ? 'Creating link…' : 'Create link'}
          </Button>
        )}

        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>Done</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
