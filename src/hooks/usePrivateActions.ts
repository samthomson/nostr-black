import { generateSecretKey, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useRouting } from '@/data/hooks/useRouting';
import { useBlossomUpload } from '@/hooks/useBlossomUpload';
import { useBlossomServers } from '@/data/hooks/useBlossomServers';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { useBroadcastFlow, type PendingUploads, type UploadedFile } from '@/hooks/useBroadcastFlow';
import { store } from '@/data/store';
import { mediaTags } from '@/lib/fileMessage';
import { conversationOf, type Conversation, type OpenedReply } from '@/lib/feedEncryptionRead';
import { makeRumor, wrapPrivateNote, wrapPrivateReply, type OpenedNote, type EventLayer, type Rumor } from '@/lib/feedEncryption';
import { remintRumor } from '@/lib/fileMessage';
import type { StagedImage } from '@/hooks/usePrivateImagePrep';
import {
  KIND_PRIVATE_NOTE,
  deletePrivateEvent,
  makeRevision,
  privateNoteLayers,
} from '@/lib/feedEncryption';

/**
 * The private conversation actions — post, reply, react, edit, delete —
 * shared by every surface that shows an opened private note (the feed and
 * the thread page). Everything here is a broadcast through the standard
 * flow: burner-signed, sealed, queued only after the modal confirms.
 * Images are pre-encrypted descriptors: their ciphertext uploads inside
 * the confirmed request, their media tags ride the kind-1 rumor.
 */
export const usePrivateActions = () => {
  const sk = useSessionKey();
  const { myWrite } = useRouting();
  const { request, dialog } = useBroadcastFlow();
  const upload = useBlossomUpload();
  const { servers } = useBlossomServers();
  // The pages render these actions only behind their session-key guard.
  const key = sk!;
  const publishTargets = myWrite;
  const discoveryTargets = DEFAULT_DISCOVERY_RELAYS.filter((url) => !publishTargets.includes(url));

  /** Preview a private broadcast: everything here is burner-signed and
   * goes to our write relays — the one place those facts are stated. */
  const privateRequest = (
    label: string,
    content: string,
    payload:
      | { events: readonly NostrEvent[] }
      | { uploads: PendingUploads; buildEvents: (uploaded: readonly UploadedFile[]) => readonly NostrEvent[] },
    opts: {
      layers?: readonly EventLayer[];
      extraRelays?: readonly string[];
      labels?: readonly string[];
      onEdit?: (content: string) => void;
      onEnqueued?: () => void;
    } = {},
  ): void => {
    request({
      grade: 'private',
      label,
      content,
      identityPubkey: getPublicKey(key),
      identityNote: 'burner-signed',
      relays: publishTargets,
      ...payload,
      ...opts,
    });
  };

  /** The deferred uploads for pre-encrypted images: ciphertext to the
   * first blossom server, the kind-24242 auth signed by a throwaway —
   * it correlates with nothing, not even the burner. */
  const uploadsOf = (media: readonly StagedImage[]): PendingUploads => {
    const throwaway = generateSecretKey();
    const server = servers[0]!;
    return {
      count: media.length,
      server,
      signUploadsWith: throwaway,
      run: async () => Promise.all(media.map(async (image) => {
        const blob = await upload(image.ct, 'application/octet-stream', throwaway, server);
        return { url: blob.url, sha256: blob.sha256, mime: image.mime };
      })),
    };
  };

  const post = (
    content: string,
    peers: readonly string[],
    media: readonly StagedImage[],
    cekAndRumor: { rumor: Rumor; replyCek: Uint8Array },
    handlers: { onEdit?: (content: string) => void; onEnqueued?: () => void } = {},
  ): void => {
    // The conversation was minted at submit start — its reply CEK
    // encrypted the images. The media tags land on the minted shell
    // with the note's content: one event, image attached to its note.
    const rumorOf = (urls: readonly string[]): Rumor =>
      remintRumor(cekAndRumor.rumor, {
        content,
        tags: [...cekAndRumor.rumor.tags, ...mediaTags(media.map((image, i) => ({ ...image, url: urls[i]! })), cekAndRumor.replyCek)],
      });
    if (media.length === 0) {
      const events = wrapPrivateNote(key, peers, rumorOf([]));
      privateRequest('private note', content, { events }, {
        extraRelays: discoveryTargets,
        layers: privateNoteLayers(key, events[0]!),
        labels: events.map((_, i) => (events.length > 1 ? `private note (${i + 1} of ${events.length})` : 'private note')),
        ...handlers,
      });
      return;
    }
    privateRequest('private note', content, {
      uploads: uploadsOf(media),
      buildEvents: (uploaded) =>
        wrapPrivateNote(key, peers, rumorOf(uploaded.map((file) => file.url))),
    }, {
      extraRelays: discoveryTargets,
      ...handlers,
    });
  };

  // A private reaction is a kind-7 rumor in the conversation's channel:
  // wrapped under the reply CEK like a reply, addressed by `e` tag, so
  // every holder opens it with keys they already have — no new query,
  // nothing observable on relays beyond one more sealed 1470. Reacting
  // is a broadcast like everything else: the heart opens the modal,
  // confirmation enqueues; the emoji comes from the default-reaction
  // setting or the long-press picker.
  const react = (parent: OpenedNote, target: Rumor, conversation: Conversation, emoji: string) => {
    const me = getPublicKey(key);
    const mine = conversation.reactions
      .filter((r) => r.rumor.pubkey === me && r.rumor.tags.find(([n]) => n === 'e')?.[1] === target.id)
      .sort((a, b) => b.rumor.created_at - a.rumor.created_at)[0];
    if (mine) {
      privateRequest('reaction deletion', `delete your ${mine.rumor.content} reaction`, {
        events: [deletePrivateEvent(key, mine.wrapper)],
      });
      return;
    }
    const { rumor } = makeRumor(me, emoji, [['e', target.id]], 7);
    const event = wrapPrivateReply(key, parent.replyCek, rumor);
    privateRequest('reaction', `${emoji} on ${target.content.slice(0, 64)}`, { events: [event] }, {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(key, event, parent.replyCek),
    });
  };

  const reply = (parent: OpenedNote, content: string, media: readonly StagedImage[] = []) => {
    const eventOf = (urls: readonly string[]): NostrEvent => {
      const { rumor } = makeRumor(getPublicKey(key), content, [
        ['e', parent.rumor.id],
        ...mediaTags(media.map((image, i) => ({ ...image, url: urls[i]! })), parent.replyCek),
      ]);
      return wrapPrivateReply(key, parent.replyCek, rumor);
    };
    if (media.length === 0) {
      const event = eventOf([]);
      privateRequest('private reply', content, { events: [event] }, {
        extraRelays: discoveryTargets,
        layers: privateNoteLayers(key, event, parent.replyCek),
      });
      return;
    }
    privateRequest('private reply', content, {
      uploads: uploadsOf(media),
      buildEvents: (uploaded) => [eventOf(uploaded.map((file) => file.url))],
    }, { extraRelays: discoveryTargets });
  };

  const edit = (parent: OpenedNote, content: string) => {
    // One slotless event under the reply CEK: every holder already has
    // the key, so one revision covers the whole audience — no slots,
    // no aliases, no connection state.
    const revision = makeRevision(getPublicKey(key), parent.rumor, content);
    const event = wrapPrivateReply(key, parent.replyCek, revision);
    privateRequest('revision', content, { events: [event] }, {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(key, event, parent.replyCek),
    });
  };

  const editReply = (parent: OpenedNote, reply: OpenedReply, content: string) => {
    const revision = makeRevision(getPublicKey(key), reply.rumor, content);
    const event = wrapPrivateReply(key, parent.replyCek, revision);
    privateRequest('reply revision', content, { events: [event] }, {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(key, event, parent.replyCek),
    });
  };

  const remove = (parent: OpenedNote, history: readonly OpenedNote[]) => {
    // The publication's chunks, plus our own revision events — each holds
    // its burner in the `b` tag, so all are deletable.
    const wrappers = [
      ...conversationOf(key, store.queryByKind(KIND_PRIVATE_NOTE), parent),
      ...history.map((h) => h.wrapper),
    ].filter((wrapper, i, all) => all.findIndex((w) => w.id === wrapper.id) === i);
    const events = wrappers.map((wrapper) => deletePrivateEvent(key, wrapper));
    privateRequest(
      'deletion',
      `delete this note — ${events.length} ${events.length === 1 ? 'event' : 'events'} (chunks and revisions)`,
      { events },
      { labels: events.map((_, i) => `deletion (${i + 1} of ${events.length})`) },
    );
  };

  return { sk, dialog, post, reply, react, edit, editReply, remove };
};
