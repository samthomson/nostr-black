import { useState } from 'react';
import { nowSec } from '@/lib/timestamp';
import { getPublicKey, finalizeEvent, nip10 } from 'nostr-tools';
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
  const { config } = useAppContext();
  const upload = useBlossomUpload();
  const { servers } = useBlossomServers();
  const { attachments, addFiles, remove: removeAttachment, clear } = useAttachments();

  if (!user || !sk) return null;
  // Broadcast targets are known before preview: our declared write set.
  const publishTargets = myWrite;

  /** The current preview for the draft as it stands. `burner` re-signs
   *  under the given key (null = the session identity) — the modal's
   *  standard burner switch calls it; nothing here tracks the choice,
   *  the returned pending is the state. */
  const previewOf = (content: string, burner: Uint8Array | null): PendingBroadcast => {
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
      setBurner: (next) => previewOf(content, next),
      onEdit: (next) => {
        setDraft(next);
        request(previewOf(next, burner));
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
            run: async (onProgress?: (done: number, total: number, loaded: number, fileBytes: number) => void): Promise<UploadedImage[]> => {
              const uploaded: UploadedImage[] = [];
              for (let i = 0; i < staged.length; i++) {
                const file = staged[i]!;
                const compressed = await prepareImage(file, config.imageCompression);
                const blob = await upload(compressed.bytes, compressed.type, signer, servers[0], (loaded, total) => {
                  onProgress?.(i, staged.length, loaded, total);
                });
                uploaded.push({
                  url: blob.url,
                  sha256: blob.sha256,
                  mime: compressed.type,
                  dim: compressed.width > 0 ? `${compressed.width}x${compressed.height}` : undefined,
                });
              }
              return uploaded;
            },
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
      // The queued broadcast is the commit point: clear the draft and
      // the burner so the next compose starts clean. The burner pubkey
      // is remembered so the feed keeps rendering its notes as yours.
      onEnqueued: () => {
        if (burner) rememberBurner(user.pubkey, pk!);
        setDraft('');
        clear();
      },
    };
  };

  const submit = () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    request(previewOf(text, null));
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
