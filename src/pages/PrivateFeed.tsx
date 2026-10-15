import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Loader2 } from 'lucide-react';
import { getPublicKey } from 'nostr-tools';
import { Shell } from '@/components/Shell';
import { PrivacyTag } from '@/components/PrivacyTag';
import { PrivateNote } from '@/components/PrivateNote';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { usePrivateFeed } from '@/data/hooks/usePrivateFeed';
import { usePublishSigned } from '@/hooks/usePublishSigned';
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

const PrivateFeedBody = () => {
  const { user } = useCurrentUser();
  const sk = useSessionKey();
  const publishSigned = usePublishSigned();
  const { posts, pending, connectedPeers } = usePrivateFeed();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!user) {
    return <p className="text-muted-foreground text-sm">log in to use the private feed</p>;
  }
  if (!sk) {
    return (
      <p className="text-muted-foreground text-sm">
        session key required — nsec login only. an extension cannot derive aliases or open envelopes.
      </p>
    );
  }

  const post = async (content: string) => {
    const { rumor } = makeRumor(getPublicKey(sk), content);
    const events = wrapPrivateNote(sk, connectedPeers, rumor);
    for (const event of events) await publishSigned(event);
  };

  const reply = async (parent: OpenedNote, content: string) => {
    const { rumor } = makeRumor(getPublicKey(sk), content, [['e', parent.rumor.id]]);
    await publishSigned(wrapPrivateReply(sk, parent.replyCek, rumor));
  };

  const edit = async (parent: OpenedNote, content: string) => {
    if (!sk) throw new Error('session key required');
    // One slotless event under the reply CEK: every holder already has
    // the key, so one revision covers the whole audience — no slots,
    // no aliases, no connection state.
    const revision = makeRevision(getPublicKey(sk), parent.rumor, content);
    await publishSigned(wrapPrivateReply(sk, parent.replyCek, revision));
  };
  const editReply = async (parent: OpenedNote, reply: OpenedReply, content: string) => {
    if (!sk) throw new Error('session key required');
    const revision = makeRevision(getPublicKey(sk), reply.rumor, content);
    await publishSigned(wrapPrivateReply(sk, parent.replyCek, revision));
  };

  const remove = async (parent: OpenedNote, history: readonly OpenedNote[]) => {
    if (!sk) throw new Error('session key required');
    // The publication's chunks, plus our own revision events — each holds
    // its burner in the `b` tag, so all are deletable.
    const wrappers = [
      ...conversationOf(sk, store.queryByKind(KIND_PRIVATE_NOTE), parent),
      ...history.map((h) => h.wrapper),
    ].filter((wrapper, i, all) => all.findIndex((w) => w.id === wrapper.id) === i);
    for (const wrapper of wrappers) {
      await publishSigned(deletePrivateEvent(sk, wrapper));
    }
  };

  const submit = async () => {
    const content = draft.trim();
    if (!content || busy || connectedPeers.length === 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await post(content);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
            disabled={busy || draft.trim().length === 0}
            onClick={() => void submit()}
            className={cn(PRIVACY_BUTTON, 'self-end', PRIVACY.private.className)}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'post'}
          </Button>
        </div>
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}

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
    <Shell>
      <div className="mb-3 flex items-center gap-2">
        <h1 className="text-lg font-semibold">private feed</h1>
        <PrivacyTag grade="private" />
      </div>
      <PrivateFeedBody />
    </Shell>
  );
};

export default PrivateFeedPage;
