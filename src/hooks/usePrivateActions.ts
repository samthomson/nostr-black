import { getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useRouting } from '@/data/hooks/useRouting';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { store } from '@/data/store';
import { conversationOf, type Conversation, type OpenedReply } from '@/lib/feedEncryptionRead';
import {
  KIND_PRIVATE_NOTE,
  deletePrivateEvent,
  makeRevision,
  makeRumor,
  privateNoteLayers,
  wrapPrivateNote,
  wrapPrivateReply,
  type OpenedNote,
  type EventLayer,
  type Rumor,
} from '@/lib/feedEncryption';

/**
 * The private conversation actions — post, reply, react, edit, delete —
 * shared by every surface that shows an opened private note (the feed and
 * the thread page). Everything here is a broadcast through the standard
 * flow: burner-signed, sealed, queued only after the modal confirms.
 */
export const usePrivateActions = () => {
  const sk = useSessionKey();
  const { myWrite } = useRouting();
  const { request, dialog } = useBroadcastFlow();
  // The pages render these actions only behind their session-key guard.
  const key = sk!;
  const publishTargets = myWrite;
  const discoveryTargets = DEFAULT_DISCOVERY_RELAYS.filter((url) => !publishTargets.includes(url));

  /** Preview a private broadcast: everything here is burner-signed and
   * goes to our write relays — the one place those facts are stated. */
  const privateRequest = (
    label: string,
    content: string,
    events: readonly NostrEvent[],
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
      events,
      ...opts,
    });
  };

  const post = (
    content: string,
    peers: readonly string[],
    handlers: { onEdit?: (content: string) => void; onEnqueued?: () => void } = {},
  ): void => {
    const { rumor } = makeRumor(getPublicKey(key), content);
    const events = wrapPrivateNote(key, peers, rumor);
    privateRequest('private note', content, events, {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(key, events[0]),
      labels: events.map((_, i) => (events.length > 1 ? `private note (${i + 1} of ${events.length})` : 'private note')),
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
      privateRequest('reaction deletion', `delete your ${mine.rumor.content} reaction`, [
        deletePrivateEvent(key, mine.wrapper),
      ]);
      return;
    }
    const { rumor } = makeRumor(me, emoji, [['e', target.id]], 7);
    const event = wrapPrivateReply(key, parent.replyCek, rumor);
    privateRequest('reaction', `${emoji} on ${target.content.slice(0, 64)}`, [event], {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(key, event, parent.replyCek),
    });
  };

  const reply = (parent: OpenedNote, content: string) => {
    const { rumor } = makeRumor(getPublicKey(key), content, [['e', parent.rumor.id]]);
    const event = wrapPrivateReply(key, parent.replyCek, rumor);
    privateRequest('private reply', content, [event], {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(key, event, parent.replyCek),
    });
  };

  const edit = (parent: OpenedNote, content: string) => {
    // One slotless event under the reply CEK: every holder already has
    // the key, so one revision covers the whole audience — no slots,
    // no aliases, no connection state.
    const revision = makeRevision(getPublicKey(key), parent.rumor, content);
    const event = wrapPrivateReply(key, parent.replyCek, revision);
    privateRequest('revision', content, [event], {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(key, event, parent.replyCek),
    });
  };

  const editReply = (parent: OpenedNote, reply: OpenedReply, content: string) => {
    const revision = makeRevision(getPublicKey(key), reply.rumor, content);
    const event = wrapPrivateReply(key, parent.replyCek, revision);
    privateRequest('reply revision', content, [event], {
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
      events,
      { labels: events.map((_, i) => `deletion (${i + 1} of ${events.length})`) },
    );
  };

  return { sk, dialog, post, reply, react, edit, editReply, remove };
};
