import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Loader2 } from 'lucide-react';
import { getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';
import { Page } from '@/components/Page';
import { PrivacyTag } from '@/components/PrivacyTag';
import { PrivateNote } from '@/components/PrivateNote';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { usePrivateFeed } from '@/data/hooks/usePrivateFeed';
import { useRouting } from '@/data/hooks/useRouting';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import type { EventLayer } from '@/components/BroadcastDialog';
import { decryptCt, openEnvelopeWithCek, parseEnvelope } from '@/lib/falseBottom';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { openPrivateNote } from '@/lib/feedEncryption';
import { store } from '@/data/store';
import { conversationOf, type OpenedReply } from '@/lib/feedEncryptionRead';
import {
  KIND_PRIVATE_NOTE,
  deletePrivateEvent,
  makeRevision,
  makeRumor,
  wrapPrivateNote,
  wrapPrivateReply,
  type OpenedNote,
} from '@/lib/feedEncryption';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';

/**
 * The decoded layers of one private wrapper: the outer event (envelope
 * elided), the author seal, and the rumour — each fully decoded via the
 * app's own opening path.
 */
const noteLayers = (sk: Uint8Array, wrapper: NostrEvent | undefined): readonly EventLayer[] | undefined => {
  if (!wrapper) return undefined;
  let seal: NostrEvent | undefined;
  let rumour: unknown;
  try {
    const opened = openPrivateNote(sk, wrapper);
    const envelope = parseEnvelope(wrapper.content);
    const { cek, payload } = openEnvelopeWithCek(sk, wrapper.pubkey, envelope);
    void cek; void payload; void opened;
    // The seal is the JSON inside ct; recover it by re-encrypting is
    // wrong — instead decode through the seal's own key: the ct is
    // AEAD(CEK, seal JSON) and we hold the CEK from the slot.
    seal = JSON.parse(new TextDecoder().decode(decryptCt(cek, envelope.ct))) as NostrEvent;
    rumour = opened.rumor;
  } catch {
    // layers are best-effort
  }
  return [
    { name: 'wrapper', decoded: { ...wrapper, content: '‹envelope›' } },
    { name: 'seal', decoded: seal ?? '‹undecodable›' },
    { name: 'rumour', decoded: rumour ?? '‹undecodable›' },
  ];
};

const PrivateFeedBody = () => {
  const sk = useSessionKey();
  const { myWrite } = useRouting();
  const { request, dialog } = useBroadcastFlow();
  const publishTargets = myWrite;
  const discoveryTargets = DEFAULT_DISCOVERY_RELAYS.filter((url) => !publishTargets.includes(url));
  const { posts, pending, connectedPeers } = usePrivateFeed();
  const [draft, setDraft] = useState('');

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
    request({
      grade: 'private',
      label: 'private note',
      preview: content,
      identityPubkey: getPublicKey(sk),
      identityNote: 'burner-signed',
      relays: publishTargets,
      extraRelays: discoveryTargets,
      layers: noteLayers(sk, events[0]),
      events,
      labels: events.map((_, i) => (events.length > 1 ? `private note (${i + 1} of ${events.length})` : 'private note')),
    });
  };

  const reply = (parent: OpenedNote, content: string) => {
    const { rumor } = makeRumor(getPublicKey(sk), content, [['e', parent.rumor.id]]);
    request({
      grade: 'private',
      label: 'private reply',
      preview: content,
      identityPubkey: getPublicKey(sk),
      identityNote: 'burner-signed',
      relays: publishTargets,
      extraRelays: discoveryTargets,
      events: [wrapPrivateReply(sk, parent.replyCek, rumor)],
    });
  };

  const edit = (parent: OpenedNote, content: string) => {
    // One slotless event under the reply CEK: every holder already has
    // the key, so one revision covers the whole audience — no slots,
    // no aliases, no connection state.
    const revision = makeRevision(getPublicKey(sk), parent.rumor, content);
    request({
      grade: 'private',
      label: 'revision',
      preview: content,
      identityPubkey: getPublicKey(sk),
      identityNote: 'burner-signed',
      relays: publishTargets,
      extraRelays: discoveryTargets,
      events: [wrapPrivateReply(sk, parent.replyCek, revision)],
    });
  };
  const editReply = (parent: OpenedNote, reply: OpenedReply, content: string) => {
    const revision = makeRevision(getPublicKey(sk), reply.rumor, content);
    request({
      grade: 'private',
      label: 'reply revision',
      preview: content,
      identityPubkey: getPublicKey(sk),
      identityNote: 'burner-signed',
      relays: publishTargets,
      extraRelays: discoveryTargets,
      events: [wrapPrivateReply(sk, parent.replyCek, revision)],
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
    request({
      grade: 'private',
      label: 'deletion',
      preview: `delete this note — ${events.length} ${events.length === 1 ? 'event' : 'events'} (chunks and revisions)`,
      identityPubkey: getPublicKey(sk),
      identityNote: 'burner-signed',
      relays: publishTargets,
      events,
      labels: events.map((_, i) => `deletion (${i + 1} of ${events.length})`),
    });
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
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="write a private note…"
            aria-label="write a private note"
            rows={3}
            className="border-input bg-background min-h-[4.5rem] min-w-0 flex-1 resize-none rounded-sm border px-3 py-2 text-sm"
          />
          <Button
            type="button"
            variant="privacy"
            disabled={draft.trim().length === 0}
            onClick={submit}
            className={cn(PRIVACY_BUTTON, 'self-end', PRIVACY.private.className)}
          >
            broadcast
          </Button>
        </div>
      )}

      {dialog}

      {posts.map((item) => (
        <PrivateNote
          key={item.note.rumor.id}
          note={item.note}
          history={item.history}
          replies={item.replies}
          onReply={reply}
          onEdit={edit}
          onEditReply={editReply}
          onDelete={remove}
        />
      ))}

      {!pending && connectedPeers.length === 0 && empty(
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
