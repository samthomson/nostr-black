import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { getPublicKey } from 'nostr-tools';
import { Page } from '@/components/Page';
import { PrivacyTag } from '@/components/PrivacyTag';
import { PrivateNote } from '@/components/PrivateNote';
import { Composer } from '@/components/Composer';
import { FeedSkeleton } from '@/components/NoteSkeleton';
import { Card, CardContent } from '@/components/ui/card';
import { usePrivateFeed } from '@/data/hooks/usePrivateFeed';
import { useAttachments } from '@/hooks/useAttachments';
import { usePrivateActions } from '@/hooks/usePrivateActions';
import { usePrivateImagePrep, type StagedImage } from '@/hooks/usePrivateImagePrep';
import { mintConversation } from '@/lib/fileMessage';
import type { Rumor } from '@/lib/feedEncryption';

const PrivateFeedBody = () => {
  const { sk, dialog, post, reply, react, edit, editReply, remove } = usePrivateActions();
  const { posts, pending, connectedPeers } = usePrivateFeed();
  const [draft, setDraft] = useState('');
  const { attachments, addFiles, remove: removeAttachment, clear } = useAttachments();
  const prepImages = usePrivateImagePrep();
  const [prepping, setPrepping] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  // The minted conversation plus its pre-encrypted images, kept for the
  // modal's edit tab: a re-preview re-posts with the same key the
  // ciphertext was derived under.
  const stagedRef = useRef<{ rumor: Rumor; replyCek: Uint8Array; media: readonly StagedImage[] } | null>(null);

  // The router's gate guarantees a user here.
  if (!sk) {
    return (
      <p className="text-muted-foreground text-sm">
        session key required — nsec login only. an extension cannot derive aliases or open envelopes.
      </p>
    );
  }

  // The modal's edit handler re-previews with the same handlers attached —
  // dropping them on recursion left the modal editor dead after one
  // keystroke (the in-modal edit bug). Enqueue is the commit point: only
  // then does the page draft clear, so cancelling hands the text back —
  // and the staged images go with it.
  const handlers = {
    onEdit: (next: string) => {
      setDraft(next);
      const staged = stagedRef.current;
      if (staged) post(next, connectedPeers, staged.media, staged, handlers);
    },
    onEnqueued: () => {
      setDraft('');
      clear();
      stagedRef.current = null;
    },
  };

  // Submit mints the conversation first — its reply CEK encrypts the
  // staged images, all local — then previews the note. The ciphertext
  // leaves only when the modal confirms; a prep failure surfaces here,
  // staged images are never dropped silently, and image-only notes (no
  // text) send with the attachments alone.
  const submit = () => {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || prepping || connectedPeers.length === 0) return;
    setPrepError(null);
    setPrepping(true);
    void (async () => {
      try {
        const minted = mintConversation(getPublicKey(sk));
        const media = attachments.length > 0
          ? await prepImages(minted.replyCek, attachments.map((a) => a.file))
          : [];
        stagedRef.current = { ...minted, media };
        post(content, connectedPeers, media, minted, handlers);
      } catch (e) {
        setPrepError(e instanceof Error ? e.message : String(e));
      } finally {
        setPrepping(false);
      }
    })();
  };

  const empty = (text: string, action?: { to: string; label: string }) => (
    <Card className="border-dashed">
      <CardContent className="px-8 py-12 text-center">
        <p className="text-muted-foreground mx-auto max-w-sm">{text}</p>
        {action && (
          <Link
            to={action.to}
            className="text-foreground mt-4 inline-flex cursor-pointer items-center justify-center rounded-sm border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            {action.label}
          </Link>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-3">
      {connectedPeers.length > 0 && (
        <>
          <Composer
            value={draft}
            onChange={setDraft}
            onSubmit={submit}
            busy={prepping}
            variant="post"
            grade="private"
            attachments={attachments}
            onAddFiles={addFiles}
            onRemoveAttachment={removeAttachment}
          />
          {prepError && (
            <p className="text-red-500 px-1 pt-1 text-xs">prep failed: {prepError}</p>
          )}
        </>
      )}
      {pending && posts.length === 0 && <FeedSkeleton />}
      {!pending && connectedPeers.length === 0 && empty(
        "only once you've connected with people can you make private posts",
        { to: '/connections', label: 'add connections' },
      )}

      {dialog}

      {posts.map((item) => (
        <PrivateNote
          key={item.note.rumor.id}
          note={item.note}
          history={item.history}
          replies={item.replies}
          conversation={item.conversation}
          open={false}
          pending={pending}
          onReply={reply}
          onReact={(note, target, emoji) => react(note, target, item.conversation, emoji)}
          onEdit={edit}
          onEditReply={editReply}
          onDelete={remove}
        />
      ))}

      {!pending && connectedPeers.length > 0 && posts.length === 0 && empty(
        'no private notes yet — start the first one above',
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
