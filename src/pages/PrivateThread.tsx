import { useSeoMeta } from '@unhead/react';
import { nip19 } from 'nostr-tools';
import { useParams } from 'react-router-dom';
import { Page } from '@/components/Page';
import { PrivateNote } from '@/components/PrivateNote';
import { FeedSkeleton } from '@/components/NoteSkeleton';
import { Card, CardContent } from '@/components/ui/card';
import { usePrivateFeed } from '@/data/hooks/usePrivateFeed';
import { usePrivateActions } from '@/hooks/usePrivateActions';
import NotFound from '@/pages/NotFound';

/**
 * One private note opened, mirroring the public thread page: the note,
 * its replies indented under it, and the reply composer. The conversation
 * is re-derived by the same private-feed query the feed itself uses.
 */
const PrivateThreadBody = ({ id }: { id: string }) => {
  const { sk, dialog, reply, react, edit, editReply, remove } = usePrivateActions();
  const { posts, pending } = usePrivateFeed();

  // The router's gate guarantees a user here.
  if (!sk) {
    return (
      <p className="text-muted-foreground text-sm">
        session key required — nsec login only. an extension cannot derive aliases or open envelopes.
      </p>
    );
  }

  if (pending) return <FeedSkeleton count={1} grade="private" />;

  const item = posts.find((post) => post.note.rumor.id === id);
  if (!item) {
    return (
      <Card className="border-dashed">
        <CardContent className="px-8 py-12 text-center">
          <p className="text-muted-foreground mx-auto max-w-sm">
            couldn't find that note in your conversations
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <PrivateNote
        note={item.note}
        history={item.history}
        replies={item.replies}
        conversation={item.conversation}
        open
        pending={false}
        onReply={reply}
        onReact={(note, target, emoji) => react(note, target, item.conversation, emoji)}
        onEdit={edit}
        onEditReply={editReply}
        onDelete={remove}
      />
      {dialog}
    </div>
  );
};

export const PrivateThreadPage = () => {
  const { nip19: identifier } = useParams<{ nip19: string }>();
  useSeoMeta({ title: 'private note — nostr.black' });

  if (!identifier) return <NotFound />;

  // The address names the rumor id, bech32 like every other note address —
  // but namespaced under /private: it is only ever resolvable by a
  // conversation holder, never fetchable from relays.
  let id: string;
  try {
    const decoded = nip19.decode(identifier);
    id = decoded.type === 'note' ? decoded.data
      : decoded.type === 'nevent' ? decoded.data.id
      : '';
  } catch {
    id = '';
  }
  if (!id) return <NotFound />;

  return (
    <Page>
      <PrivateThreadBody id={id} />
    </Page>
  );
};
