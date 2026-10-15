import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Note } from '@/components/Note';
import { useProvenance } from '@/data/hooks/useProvenance';
import type { OpenedNote, Rumor } from '@/lib/feedEncryption';
import type { OpenedReply } from '@/lib/feedEncryptionRead';
import { formatTimestamp } from '@/lib/format';
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
  onEdit,
  onDelete,
}: {
  rumor: Rumor;
  wrapper: NostrEvent;
  onEdit?: (content: string) => void;
  onDelete?: () => void;
}) => {
  const { foundOn, route } = useProvenance(wrapper.id);
  return (
    <Note
      event={rumor}
      wrapper={wrapper}
      foundOn={foundOn}
      route={route}
      onEdit={onEdit}
      onDelete={onDelete}
    />
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

/** A note's superseded versions — the edit history, oldest first. */
const EditHistory = ({ history }: { history: readonly OpenedNote[] }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-muted-foreground space-y-1 text-xs">
      <button
        type="button"
        className="underline hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        edited — {history.length} {history.length === 1 ? 'version' : 'versions'}
      </button>
      {open && history.map((item) => (
        <p key={item.rumor.id} className="whitespace-pre-wrap break-words border-l pl-2">
          {formatTimestamp(item.rumor.created_at)} — {item.rumor.content}
        </p>
      ))}
    </div>
  );
};

/**
 * One private post: the note, its replies, and the composer. Every item —
 * post or reply — renders through the same Note component the public feed
 * uses; replies indent under it, thread-style.
 */
export const PrivateNote = ({
  note,
  history,
  replies,
  onReply,
  onEdit,
  onEditReply,
  onDelete,
}: {
  note: OpenedNote;
  history: readonly OpenedNote[];
  replies: readonly OpenedReply[];
  onReply: (parent: OpenedNote, content: string) => void;
  onEdit?: (parent: OpenedNote, content: string) => void;
  onEditReply?: (parent: OpenedNote, reply: OpenedReply, content: string) => void;
  onDelete?: (parent: OpenedNote, history: readonly OpenedNote[]) => void;
}) => (
  <div className="space-y-3">
    <PrivateItem
      rumor={note.rumor}
      wrapper={note.wrapper}
      onEdit={onEdit ? (content) => onEdit(note, content) : undefined}
      onDelete={onDelete ? () => onDelete(note, history) : undefined}
    />
    <div className="space-y-3 border-l pl-3">
      {history.length > 0 && <EditHistory history={history} />}
      {replies.map((reply) => (
        <PrivateItem
          key={reply.wrapper.id}
          rumor={reply.rumor}
          wrapper={reply.wrapper}
          onEdit={onEditReply ? (content) => onEditReply(note, reply, content) : undefined}
        />
      ))}
      <ReplyComposer parent={note} onReply={onReply} />
    </div>
  </div>
);
