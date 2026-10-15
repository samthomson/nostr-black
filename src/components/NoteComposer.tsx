import { useState } from 'react';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools';
import { rememberBurner } from '@/auth/burners';
import type { NostrEvent } from '@nostrify/nostrify';
import { useBroadcastFlow, type PendingBroadcast } from '@/hooks/useBroadcastFlow';
import { Button } from '@/components/ui/button';
import { useRouting } from '@/data/hooks/useRouting';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { clientTag } from '@/lib/clientTag';
import { DraftSwitch } from '@/components/BroadcastDialog';

/**
 * The public note composer: write, preview, broadcast. The burner toggle
 * lives in the modal and is live — flipping it re-previews (new identity,
 * one grade greyer, re-signed event) before anything is queued.
 */
export const NoteComposer = () => {
  const { user } = useCurrentUser();
  const sk = useSessionKey();
  const { myWrite } = useRouting();
  const { request, dialog } = useBroadcastFlow();
  const [draft, setDraft] = useState('');
  const [burnerSk, setBurnerSk] = useState<Uint8Array | null>(null);

  if (!user || !sk) return null;
  // Broadcast targets are known before preview: our declared write set.
  const publishTargets = myWrite;

  /** The current preview for the draft as it stands. `nextBurner`
   * overrides the state — the toggle knows the value it is switching to
   * before React has applied it. */
  const previewOf = (content: string, nextBurner?: Uint8Array | null): PendingBroadcast => {
    const burner = nextBurner !== undefined ? nextBurner : burnerSk;
    const pk = burner ? getPublicKey(burner) : null;
    return {
      grade: burner ? 'medium' : 'public',
      label: 'note',
      preview: content,
      identityPubkey: pk ?? user.pubkey,
      identityNote: pk ? 'burner' : undefined,
      relays: publishTargets,
      extraRelays: DEFAULT_DISCOVERY_RELAYS.filter((url) => !publishTargets.includes(url)),
      controls: (
        <div className="flex flex-wrap items-center gap-4">
          <DraftSwitch on={burner !== null} onToggle={() => toggleBurner(content, burner)} label="burner" ariaLabel="broadcast via a burner" />
          {burner && (
            <DraftSwitch on={true} onToggle={() => setBurnerSk(generateSecretKey())} label="new burner" ariaLabel="generate a new burner key" />
          )}
        </div>
      ),
      events: [signedNote(burner ?? sk, content)],
      // The queued broadcast is the commit point: clear the draft and the
      // burner so the next compose starts clean. The burner pubkey is
      // remembered so the feed keeps rendering its notes as yours.
      onEnqueued: () => {
        if (burner) rememberBurner(user.pubkey, getPublicKey(burner));
        setDraft('');
        setBurnerSk(null);
      },
    };
  };

  /** Toggling re-previews in place: new identity, greyer grade,
   * re-signed — with the value it is switching to, not the stale one. */
  const toggleBurner = (content: string, current: Uint8Array | null) => {
    const next = current ? null : generateSecretKey();
    setBurnerSk(next);
    request(previewOf(content, next));
  };

  const preview = () => {
    if (!draft.trim()) return;
    request(previewOf(draft.trim()));
  };

  return (
    <>
      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="write a note…"
          aria-label="write a note"
          rows={3}
          className="border-input bg-background min-h-[4.5rem] min-w-0 flex-1 resize-none rounded-sm border px-3 py-2 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) preview();
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={draft.trim().length === 0}
          onClick={preview}
          className="self-end rounded-sm"
        >
          broadcast
        </Button>
      </div>
      {dialog}
    </>
  );
};


const signedNote = (sk: Uint8Array, content: string): NostrEvent => {
  const tags: string[][] = [];
  const tag = clientTag();
  if (tag) tags.push(['client', tag]);
  return finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content }, sk);
};
