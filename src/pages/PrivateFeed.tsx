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

  // The modal's edit handler re-previews with the same handlers attached —
  // dropping them on recursion left the modal editor dead after one
  // keystroke (the in-modal edit bug). Enqueue is the commit point: only
  // then does the page draft clear, so cancelling hands the text back.
  const handlers = {
    onEdit: (next: string) => {
      setDraft(next);
      post(next, connectedPeers, handlers);
    },
    onEnqueued: () => setDraft(''),
  };

  const submit = () => {
    if (!draft.trim() || connectedPeers.length === 0) return;
    post(draft.trim(), connectedPeers, handlers);
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
          variant="post"
          grade="private"
        />
      )}
      {!pending && connectedPeers.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="px-4 py-3 text-center">
            <p className="text-muted-foreground text-sm">only once you've connected with people can you make private posts</p>
          </CardContent>
        </Card>
      )}
      {pending && posts.length === 0 && <FeedSkeleton />}


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
