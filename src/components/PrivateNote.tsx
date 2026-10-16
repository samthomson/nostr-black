import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Note, ReplyCount } from '@/components/Note';
import { nip19 } from 'nostr-tools';
import { EngagementCount, type EngagementRow } from '@/components/EngagementDialog';
import { reactionsTo, type Conversation } from '@/lib/feedEncryptionRead';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useAppContext } from '@/hooks/useAppContext';
import { Heart } from 'lucide-react';
import { useProvenance } from '@/data/hooks/useProvenance';
import type { OpenedNote, Rumor } from '@/lib/feedEncryption';
import type { OpenedReply } from '@/lib/feedEncryptionRead';
import { EditHistoryDialog } from '@/components/EditHistoryDialog';
import { Button } from '@/components/ui/button';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';

/**
 * One decrypted item in the standard Note chrome. Provenance and the info
 * dialog point at the wrapper — the event relays actually hold.
 */
const PrivateItem = ({
  rumor,
  wrapper,
  conversation,
  versions,
  replyCount,
  noteHref,
  onReact,
  onEdit,
  onDelete,
}: {
  rumor: Rumor;
  wrapper: NostrEvent;
  /** The whole conversation — reactions are addressed by rumor id. */
  conversation: Conversation;
  /** The item's full version chain, oldest first, the rendered rumor last. */
  versions?: readonly Rumor[];
  /** Present on the root post in the feed: routes to the thread page. */
  replyCount?: number;
  noteHref?: string;
  /** Present when reacting is available: broadcast a private reaction. */
  onReact?: (target: Rumor, emoji: string) => void;
  onEdit?: (content: string) => void;
  onDelete?: () => void;
}) => {
  const { foundOn, route } = useProvenance(wrapper.id);
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const reactions = reactionsTo(conversation, rumor.id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const chain = versions ?? [];
  const edited = chain.length > 1;
  return (
    <>
      <Note
        event={rumor}
        wrapper={wrapper}
        foundOn={foundOn}
        route={route}
        onEdit={onEdit}
        onDelete={onDelete}
        edited={edited}
        onEditHistory={edited ? () => setHistoryOpen(true) : undefined}
      >
        {/* Deliberate divergence from the public counts row: no repost.
            A public kind 6 would leak the sealed rumor, and "reposting"
            privately means re-wrapping for another connection — a share
            feature, not a count. Replies and reactions only. */}
        <div className="text-muted-foreground flex items-center gap-4 pt-1 text-sm">
          {noteHref !== undefined && (
            <ReplyCount replies={replyCount ?? 0} pending={false} capped={false} href={noteHref} />
          )}
          <EngagementCount
            icon={<Heart className={cn('size-4', !!user && reactions.some((r) => r.pubkey === user.pubkey) && 'fill-current')} />}
            count={reactions.length}
            capped={false}
            pending={false}
            mine={!!user && reactions.some((r) => r.pubkey === user.pubkey)}
            tab="reactions"
            reactions={reactions as readonly EngagementRow[]}
            reposts={[]}
            onEngage={() => onReact?.(rumor, config.defaultReaction)}
            onChoose={(emoji) => onReact?.(rumor, emoji)}
            ariaLabel="react"
          />
        </div>
      </Note>
      {edited && (
        <EditHistoryDialog versions={chain} open={historyOpen} onOpenChange={setHistoryOpen} />
      )}
    </>
  );
};

const ReplyComposer = ({
  parent,
  onReply,
}: {
  parent: OpenedNote;
  onReply: (parent: OpenedNote, content: string) => void;
}) => {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const content = draft.trim();
    if (!content) return;
    onReply(parent, content);
    setDraft('');
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="reply…"
          aria-label="reply"
          className="border-input bg-background h-8 min-w-0 flex-1 rounded-sm border px-2 text-sm"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <Button
          type="button"
          variant="privacy"
          disabled={draft.trim().length === 0}
          onClick={() => void submit()}
          className={cn(PRIVACY_BUTTON, PRIVACY.private.className)}
        >
          reply
        </Button>
      </div>
    </div>
  );
};

/**
 * One private post, behaving exactly like a public one: in the feed it
 * shows just the note with a reply count that routes to its thread page;
 * opened (the thread page), the replies indent under it thread-style and
 * the reply composer appears. Every item — post or reply — renders through
 * the same Note component the public feed uses.
 */
export const PrivateNote = ({
  note,
  history,
  replies,
  conversation,
  open,
  onReply,
  onReact,
  onEdit,
  onEditReply,
  onDelete,
}: {
  note: OpenedNote;
  history: readonly OpenedNote[];
  replies: readonly OpenedReply[];
  /** The conversation's reactions, addressed at the note or any reply. */
  conversation: Conversation;
  /** Thread mode: replies and composer are rendered. */
  open: boolean;
  onReply: (parent: OpenedNote, content: string) => void;
  onReact?: (parent: OpenedNote, target: Rumor, emoji: string) => void;
  onEdit?: (parent: OpenedNote, content: string) => void;
  onEditReply?: (parent: OpenedNote, reply: OpenedReply, content: string) => void;
  onDelete?: (parent: OpenedNote, history: readonly OpenedNote[]) => void;
}) => (
  <div className="space-y-3">
    <PrivateItem
      rumor={note.rumor}
      wrapper={note.wrapper}
      conversation={conversation}
      versions={history.map((h) => h.rumor)}
      replyCount={replies.length}
      noteHref={open ? undefined : `/private-feed/${nip19.neventEncode({ id: note.rumor.id, author: note.rumor.pubkey, relays: [] })}`}
      onReact={onReact ? (target, emoji) => onReact(note, target, emoji) : undefined}
      onEdit={onEdit ? (content) => onEdit(note, content) : undefined}
      onDelete={onDelete ? () => onDelete(note, history) : undefined}
    />
    {open && (
      <div className="space-y-3 border-l pl-3">
        {replies.map((reply) => (
          <PrivateItem
            key={reply.wrapper.id}
            rumor={reply.rumor}
            wrapper={reply.wrapper}
            conversation={conversation}
            versions={[...(reply.history?.map((h) => h.rumor) ?? []), reply.rumor]}
            onReact={onReact ? (target, emoji) => onReact(note, target, emoji) : undefined}
            onEdit={onEditReply ? (content) => onEditReply(note, reply, content) : undefined}
          />
        ))}
        <ReplyComposer parent={note} onReply={onReply} />
      </div>
    )}
  </div>
);
