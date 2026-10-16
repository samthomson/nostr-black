import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Loader2 } from 'lucide-react';
import { getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { Page } from '@/components/Page';
import { PrivacyTag } from '@/components/PrivacyTag';
import { PrivateNote } from '@/components/PrivateNote';
import { Composer } from '@/components/Composer';
import { Card, CardContent } from '@/components/ui/card';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { usePrivateFeed } from '@/data/hooks/usePrivateFeed';
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

const PrivateFeedBody = () => {
  const sk = useSessionKey();
  const { myWrite } = useRouting();
  const { request, dialog } = useBroadcastFlow();
  const publishTargets = myWrite;
  const discoveryTargets = DEFAULT_DISCOVERY_RELAYS.filter((url) => !publishTargets.includes(url));
  const { posts, pending, connectedPeers } = usePrivateFeed();
  const [draft, setDraft] = useState('');

  /** Preview a private broadcast: everything here is burner-signed and
   * goes to our write relays — the one place those facts are stated. */
  const privateRequest = (
    label: string,
    preview: string,
    events: readonly NostrEvent[],
    opts: { layers?: readonly EventLayer[]; extraRelays?: readonly string[]; labels?: readonly string[] } = {},
  ): void => {
    request({
      grade: 'private',
      label,
      preview,
      identityPubkey: getPublicKey(sk!),
      identityNote: 'burner-signed',
      relays: publishTargets,
      events,
      ...opts,
    });
  };

  // The router's gate guarantees a user here.
  if (!sk) {
    return (
      <p className="text-muted-foreground text-sm">
        session key required — nsec login only. an extension cannot derive aliases or open envelopes.
      </p>
    );
  }

  const post = (content: string): void => {
    const { rumor } = makeRumor(getPublicKey(sk), content);
    const events = wrapPrivateNote(sk, connectedPeers, rumor);
    privateRequest('private note', content, events, {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(sk, events[0]),
      labels: events.map((_, i) => (events.length > 1 ? `private note (${i + 1} of ${events.length})` : 'private note')),
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
    const me = getPublicKey(sk);
    const mine = conversation.reactions
      .filter((r) => r.rumor.pubkey === me && r.rumor.tags.find(([n]) => n === 'e')?.[1] === target.id)
      .sort((a, b) => b.rumor.created_at - a.rumor.created_at)[0];
    if (mine) {
      privateRequest('reaction deletion', `delete your ${mine.rumor.content} reaction`, [
        deletePrivateEvent(sk, mine.wrapper),
      ]);
      return;
    }
    const { rumor } = makeRumor(me, emoji, [['e', target.id]], 7);
    const event = wrapPrivateReply(sk, parent.replyCek, rumor);
    privateRequest('reaction', `${emoji} on ${target.content.slice(0, 64)}`, [event], {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(sk, event, parent.replyCek),
    });
  };

  const reply = (parent: OpenedNote, content: string) => {
    const { rumor } = makeRumor(getPublicKey(sk), content, [['e', parent.rumor.id]]);
    const event = wrapPrivateReply(sk, parent.replyCek, rumor);
    privateRequest('private reply', content, [event], {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(sk, event, parent.replyCek),
    });
  };

  const edit = (parent: OpenedNote, content: string) => {
    // One slotless event under the reply CEK: every holder already has
    // the key, so one revision covers the whole audience — no slots,
    // no aliases, no connection state.
    const revision = makeRevision(getPublicKey(sk), parent.rumor, content);
    const event = wrapPrivateReply(sk, parent.replyCek, revision);
    privateRequest('revision', content, [event], {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(sk, event, parent.replyCek),
    });
  };
  const editReply = (parent: OpenedNote, reply: OpenedReply, content: string) => {
    const revision = makeRevision(getPublicKey(sk), reply.rumor, content);
    const event = wrapPrivateReply(sk, parent.replyCek, revision);
    privateRequest('reply revision', content, [event], {
      extraRelays: discoveryTargets,
      layers: privateNoteLayers(sk, event, parent.replyCek),
    });
  };

  const remove = (parent: OpenedNote, history: readonly OpenedNote[]) => {
    // The publication's chunks, plus our own revision events — each holds
    // its burner in the `b` tag, so all are deletable.
    const wrappers = [
      ...conversationOf(sk, store.queryByKind(KIND_PRIVATE_NOTE), parent),
      ...history.map((h) => h.wrapper),
    ].filter((wrapper, i, all) => all.findIndex((w) => w.id === wrapper.id) === i);
    const events = wrappers.map((wrapper) => deletePrivateEvent(sk, wrapper));
    privateRequest(
      'deletion',
      `delete this note — ${events.length} ${events.length === 1 ? 'event' : 'events'} (chunks and revisions)`,
      events,
      { labels: events.map((_, i) => `deletion (${i + 1} of ${events.length})`) },
    );
  };

  const submit = () => {
    if (!draft.trim() || connectedPeers.length === 0) return;
    post(draft.trim());
    setDraft('');
  };

  const empty = (text: string) => (
    <Card className="border-dashed">
      <CardContent className="px-8 py-12 text-center">
        <p className="text-muted-foreground mx-auto max-w-sm">{text}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      {pending && (
        <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-sm border bg-background/95 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          <Loader2 className="size-3.5 animate-spin" />
          fetching events{posts.length > 0 ? ` — ${posts.length} so far` : '…'}
        </div>
      )}

      {connectedPeers.length > 0 && (
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          variant="private"
        />
      )}

      {dialog}

      {posts.map((item) => (
        <PrivateNote
          key={item.note.rumor.id}
          note={item.note}
          history={item.history}
          replies={item.replies}
          conversation={item.conversation}
          onReply={reply}
          onReact={(note, target, emoji) => react(note, target, item.conversation, emoji)}
          onEdit={edit}
          onEditReply={editReply}
          onDelete={remove}
        />
      ))}

      {!pending && connectedPeers.length === 0 && posts.length === 0 && empty(
        'no connections yet — add people on the connections page first',
      )}
      {!pending && connectedPeers.length > 0 && posts.length === 0 && empty('no private notes yet')}
      {connectedPeers.length === 0 && (
        <p className="text-center text-xs">
          <Link to="/connections" className="underline">connections</Link>
        </p>
      )}
    </div>
  );
};

const PrivateFeedPage = () => {
  useSeoMeta({ title: 'private feed — nostr.black' });
  return (
    <Page title={<PrivacyTag grade="private">private feed</PrivacyTag>}>
      <PrivateFeedBody />
    </Page>
  );
};

export default PrivateFeedPage;
