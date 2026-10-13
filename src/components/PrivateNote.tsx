import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { NostrEvent } from '@nostrify/nostrify';
import { Note } from '@/components/Note';
import { useProvenance } from '@/data/hooks/useProvenance';
import type { OpenedNote, Rumor } from '@/lib/fe';
import type { OpenedReply } from '@/lib/feRead';
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
  onEdit?: (content: string) => Promise<void>;
  onDelete?: () => Promise<void>;
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
  onReply: (parent: OpenedNote, content: string) => Promise<void>;
}) => {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await onReply(parent, content);
      setDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
          disabled={busy || draft.trim().length === 0}
          onClick={() => void submit()}
          className={cn(PRIVACY_BUTTON, PRIVACY.private.className)}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'reply'}
        </Button>
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
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
  replies,
  onReply,
  onEdit,
  onDelete,
}: {
  note: OpenedNote;
  replies: readonly OpenedReply[];
  onReply: (parent: OpenedNote, content: string) => Promise<void>;
  onEdit?: (parent: OpenedNote, content: string) => Promise<void>;
  onDelete?: (parent: OpenedNote) => Promise<void>;
}) => (
  <div className="space-y-3">
    <PrivateItem
      rumor={note.rumor}
      wrapper={note.wrapper}
      onEdit={onEdit ? (content) => onEdit(note, content) : undefined}
      onDelete={onDelete ? () => onDelete(note) : undefined}
    />
    <div className="space-y-3 border-l pl-3">
      {replies.map((reply) => (
        <PrivateItem key={reply.wrapper.id} rumor={reply.rumor} wrapper={reply.wrapper} />
      ))}
      <ReplyComposer parent={note} onReply={onReply} />
    </div>
  </div>
);
