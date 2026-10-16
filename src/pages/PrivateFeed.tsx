import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Page } from '@/components/Page';
import { PrivacyTag } from '@/components/PrivacyTag';
import { PrivateNote } from '@/components/PrivateNote';
import { Composer } from '@/components/Composer';
import { FeedSkeleton } from '@/components/NoteSkeleton';
import { Card, CardContent } from '@/components/ui/card';
import { usePrivateFeed } from '@/data/hooks/usePrivateFeed';
import { usePrivateActions } from '@/hooks/usePrivateActions';

const PrivateFeedBody = () => {
  const { sk, dialog, post, reply, react, edit, editReply, remove } = usePrivateActions();
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

  const submit = () => {
    if (!draft.trim() || connectedPeers.length === 0) return;
    post(draft.trim(), connectedPeers, {
      onEdit: (next) => {
        setDraft(next);
        post(next, connectedPeers);
      },
      // Enqueue is the commit point: only now does the page draft clear,
      // so cancelling the modal hands the text back — same as the public
      // composer.
      onEnqueued: () => setDraft(''),
    });
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
      {connectedPeers.length > 0 && (
        <Composer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          variant="private"
        />
      )}

      {pending && posts.length === 0 && <FeedSkeleton />}
      {!pending && connectedPeers.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="px-4 py-3 text-center">
            <p className="text-muted-foreground text-sm">only once you've connected with people can you make private posts</p>
          </CardContent>
        </Card>
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
          onReply={reply}
          onReact={(note, target, emoji) => react(note, target, item.conversation, emoji)}
          onEdit={edit}
          onEditReply={editReply}
          onDelete={remove}
        />
      ))}

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
