import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { nowSec } from '@/lib/timestamp';
import { generateSecretKey, getPublicKey, finalizeEvent, nip10 } from 'nostr-tools';
import { rememberBurner } from '@/auth/burners';
import type { NostrEvent } from '@nostrify/nostrify';
import { useBroadcastFlow, type PendingBroadcast, type UploadedFile } from '@/hooks/useBroadcastFlow';
import { Composer } from '@/components/Composer';
import { useRouting } from '@/data/hooks/useRouting';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { clientTagOf } from '@/lib/clientTag';
import type { ClientTagConfig } from '@/contexts/AppContext';
import { DraftAction, DraftSwitch } from '@/components/BroadcastDialog';
import { useAppContext } from '@/hooks/useAppContext';
import { useAttachments } from '@/hooks/useAttachments';
import { prepareImage } from '@/lib/imageCompress';
import { useBlossomUpload } from '@/hooks/useBlossomUpload';
import { useBlossomServers } from '@/data/hooks/useBlossomServers';

/** One confirmed upload, as the note references it (NIP-92 imeta). */
interface UploadedImage extends UploadedFile {
  dim?: string;
}

/**
 * The public note composer: write, preview, broadcast — a top-level post,
 * or a reply when `parent` names the note it answers (NIP-10 tags ride
 * along). The burner toggle lives in the modal and is live — flipping it
 * re-previews (new identity, one grade greyer, re-signed event) before
 * anything is queued. Staged images compress and upload only when the
 * modal confirms, then the note builds from the returned urls.
 */
export const NoteComposer = ({ parent }: { parent?: NostrEvent }) => {
  const { user } = useCurrentUser();
  const sk = useSessionKey();
  const { myWrite } = useRouting();
  const { request, dialog } = useBroadcastFlow();
  const [draft, setDraft] = useState('');
  const [burnerSk, setBurnerSk] = useState<Uint8Array | null>(null);
  const { config } = useAppContext();
  const upload = useBlossomUpload();
  const { servers } = useBlossomServers();
  const { attachments, addFiles, remove: removeAttachment, clear } = useAttachments();

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
    const signer = burner ?? sk;
    const staged = attachments.map((a) => a.file);
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
      // No images: everything signs upfront, as it always has. With
      // images: the compressed bytes upload on confirm — burner mode
      // uploads as the burner, so the blossom auth event correlates
      // with whoever signs the note, nothing else.
      ...(staged.length === 0
        ? { events: [signedNote(signer, content, config.clientTag, parent)] }
        : {
          uploads: {
            count: staged.length,
            server: servers[0]!,
            previews: attachments.map((a) => a.previewUrl),
            signUploadsWith: signer,
            run: (): Promise<UploadedImage[]> => Promise.all(staged.map(async (file) => {
              const compressed = await prepareImage(file, config.imageCompression);
              const blob = await upload(compressed.bytes, compressed.type, signer, servers[0]);
              return {
                url: blob.url,
                sha256: blob.sha256,
                mime: compressed.type,
                dim: compressed.width > 0 ? `${compressed.width}x${compressed.height}` : undefined,
              };
            })),
          },
          buildEvents: (uploaded) => [
            signedNote(
              signer,
              [content, ...uploaded.map((file) => file.url)].filter(Boolean).join(' '),
              config.clientTag,
              parent,
              uploaded as readonly UploadedImage[],
            ),
          ],
        }),
      // The queued broadcast is the commit point: clear the draft and the
      // burner so the next compose starts clean. The burner pubkey is
      // remembered so the feed keeps rendering its notes as yours.
      onEnqueued: () => {
        if (burner) rememberBurner(user.pubkey, getPublicKey(burner));
        setDraft('');
        setBurnerSk(null);
        clear();
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

  const submit = () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    request(previewOf(text));
  };

  return (
    <>
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        variant={parent ? 'reply' : 'post'}
        grade="public"
        attachments={attachments}
        onAddFiles={addFiles}
        onRemoveAttachment={removeAttachment}
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

const signedNote = (
  sk: Uint8Array,
  content: string,
  policy: ClientTagConfig,
  parent?: NostrEvent,
  uploaded: readonly UploadedImage[] = [],
): NostrEvent => {
  const tags: string[][] = [];
  const tag = clientTagOf(policy, content);
  if (tag) tags.push(['client', tag]);
  if (parent) tags.push(...replyTagsOf(parent));
  for (const image of uploaded) {
    tags.push([
      'imeta',
      `url ${image.url}`,
      `sha256 ${image.sha256}`,
      `m ${image.mime}`,
      ...(image.dim ? [`dim ${image.dim}`] : []),
    ]);
  }
  return finalizeEvent({ kind: 1, created_at: nowSec(), tags, content }, sk);
};
