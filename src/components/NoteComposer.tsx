import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { nowSec } from '@/lib/timestamp';
import { generateSecretKey, getPublicKey, finalizeEvent, nip10 } from 'nostr-tools';
import { rememberBurner } from '@/auth/burners';
import type { NostrEvent } from '@nostrify/nostrify';
import { useBroadcastFlow, type PendingBroadcast } from '@/hooks/useBroadcastFlow';
import { Composer } from '@/components/Composer';
import { useRouting } from '@/data/hooks/useRouting';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { clientTag } from '@/lib/clientTag';
import { DraftAction, DraftSwitch } from '@/components/BroadcastDialog';

/**
 * The public note composer: write, preview, broadcast — a top-level post,
 * or a reply when `parent` names the note it answers (NIP-10 tags ride
 * along). The burner toggle lives in the modal and is live — flipping it
 * re-previews (new identity, one grade greyer, re-signed event) before
 * anything is queued.
 */
export const NoteComposer = ({ parent }: { parent?: NostrEvent }) => {
  const { user } = useCurrentUser();
  const sk = useSessionKey();
  const { myWrite } = useRouting();
  const { request, dialog } = useBroadcastFlow();
  const [draft, setDraft] = useState('');
  const [burnerSk, setBurnerSk] = useState<Uint8Array | null>(null);

  // The live burner, readable from event handlers that fire after the
  // pending preview was built (the modal's edit tab). Reading state here
  // must never see a stale null — that would re-sign as the real identity.
  const burnerRef = useRef(burnerSk);
  useEffect(() => { burnerRef.current = burnerSk; }, [burnerSk]);

  if (!user || !sk) return null;
  // Broadcast targets are known before preview: our declared write set.
  const publishTargets = myWrite;

  /** The current preview for the draft as it stands. `nextBurner`
   * overrides the live value — the toggle/rotate know the key they are
   * switching to before React has committed it. */
  const previewOf = (content: string, nextBurner?: Uint8Array | null): PendingBroadcast => {
    const burner = nextBurner !== undefined ? nextBurner : burnerRef.current;
    const pk = burner ? getPublicKey(burner) : null;
    return {
      grade: burner ? 'medium' : 'public',
      label: parent ? 'reply' : 'note',
      content,
      identityPubkey: pk ?? user.pubkey,
      identityNote: pk ? 'burner' : undefined,
      relays: publishTargets,
      extraRelays: DEFAULT_DISCOVERY_RELAYS.filter((url) => !publishTargets.includes(url)),
      controls: (
        <div className="flex flex-wrap items-center gap-4">
          <DraftSwitch on={burner !== null} onToggle={() => toggleBurner(content, burner)} label="burner" ariaLabel="broadcast via a burner" />
          {burner && (
            <DraftAction
              icon={<RefreshCw className="size-3" />}
              onClick={() => rotateBurner(content)}
              label="new burner"
              ariaLabel="generate a new burner key"
            />
          )}
        </div>
      ),
      onEdit: (next) => {
        setDraft(next);
        request(previewOf(next));
      },
      events: [signedNote(burner ?? sk, content, parent)],
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

  /** Rotating the burner re-previews like every other draft change: new
   * key, re-signed event — never a stale identity on screen. */
  const rotateBurner = (content: string) => {
    const next = generateSecretKey();
    setBurnerSk(next);
    request(previewOf(content, next));
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
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={preview}
        variant={parent ? 'reply' : 'post'}
        grade="public"
      />
      {dialog}
    </>
  );
};
/** NIP-10 tags for a reply to `parent`: keep the thread's root, point
 *  the reply marker at the parent, and carry the author along. */
const replyTagsOf = (parent: NostrEvent): string[][] => {
  const parsed = nip10.parse(parent);
  const root = parsed.root?.id ?? parent.id;
  const reply = parsed.reply?.id ?? parsed.root?.id;
  return reply
    ? [['e', root, '', 'root'], ['e', parent.id, '', 'reply'], ['p', parent.pubkey]]
    : [['e', parent.id, '', 'root'], ['p', parent.pubkey]];
};

const signedNote = (sk: Uint8Array, content: string, parent?: NostrEvent): NostrEvent => {
  const tags: string[][] = [];
  const tag = clientTag();
  if (tag) tags.push(['client', tag]);
  if (parent) tags.push(...replyTagsOf(parent));
  return finalizeEvent({ kind: 1, created_at: nowSec(), tags, content }, sk);
};
