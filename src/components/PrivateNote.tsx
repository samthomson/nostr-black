import { useState } from 'react';
import type { NostrEvent } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';
import { Note, ReplyCount } from '@/components/Note';
import { Lightbox } from '@/components/Lightbox';
import { PrivateMedia, PrivateMediaCarousel } from '@/components/PrivateMedia';
import { decryptedUrlOf } from '@/components/privateMediaCache';
import { Composer } from '@/components/Composer';
import { EngagementCount, type EngagementRow } from '@/components/EngagementDialog';
import { reactionsTo, type Conversation } from '@/lib/feedEncryptionRead';
import { useAppContext } from '@/hooks/useAppContext';
import { useAttachments } from '@/hooks/useAttachments';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { usePrivateImagePrep, type StagedImage } from '@/hooks/usePrivateImagePrep';
import { mediaImagesOf } from '@/lib/fileMessage';
import { Heart } from 'lucide-react';
import { useProvenance } from '@/data/hooks/useProvenance';
import type { OpenedNote, Rumor } from '@/lib/feedEncryption';
import type { OpenedReply } from '@/lib/feedEncryptionRead';
import { EditHistoryDialog } from '@/components/EditHistoryDialog';
import { cn } from '@/lib/utils';

/**
 * One decrypted item in the standard Note chrome. Provenance and the info
 * dialog point at the wrapper — the event relays actually hold. Media
 * tags on the item's rumor render as decrypted images under the body.
 */
export const PrivateItem = ({
  rumor,
  wrapper,
  replyCek,
  conversation,
  versions,
  replyCount,
  noteHref,
  onOpen,
  anchored,
  pending = false,
  onReact,
  onEdit,
  onDelete,
}: {
  rumor: Rumor;
  wrapper: NostrEvent;
  /** The conversation's reply CEK — it derives the image keys. */
  replyCek: Uint8Array;
  /** The whole conversation — reactions are addressed by rumor id. */
  conversation: Conversation;
  /** The item's full version chain, oldest first, the rendered rumor last. */
  versions?: readonly Rumor[];
  /** Present on the root post in the feed: routes to the thread page. */
  replyCount?: number;
  noteHref?: string;
  /** Column system: opens the next pane instead of routing. */
  onOpen?: () => void;
  /** Lit ring when the pane to the right pertains to this item. */
  anchored?: boolean;
  /** Counts render their loading state until the conversation arrives. */
  pending?: boolean;
  /** Present when reacting is available: broadcast a private reaction. */
  onReact?: (target: Rumor, emoji: string) => void;
  /** Present when the item is editable: publish a revision. */
  onEdit?: (content: string) => void;
  onDelete?: () => void;
}) => {
  const { foundOn, route } = useProvenance(wrapper.id);
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const reactions = reactionsTo(conversation, rumor.id);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [openMedia, setOpenMedia] = useState<number | null>(null);
  const chain = versions ?? [];
  const edited = chain.length > 1;
  // The lightbox set: this item's images that have decrypted this
  // session, in tag order — read at render, so a fresh decrypt rerenders
  // the whole item and the modal picks the url up.
  const decryptedImages = mediaImagesOf(rumor)
    .map((image) => decryptedUrlOf(image.x))
    .filter((u): u is string => !!u);

  return (
    <>
      <Note
        event={rumor}
        wrapper={wrapper}
        foundOn={foundOn}
        route={route}
        replyCek={replyCek}
        onOpen={onOpen}
        anchored={anchored}
        onEdit={onEdit}
        onDelete={onDelete}
        edited={edited}
        onEditHistory={edited ? () => setHistoryOpen(true) : undefined}
      >
        {(() => {
          const images = mediaImagesOf(rumor);
          if (images.length === 0) return null;
          if (images.length === 1) {
            return (
              <div className="space-y-1 pt-1">
                <PrivateMedia
                  image={images[0]!}
                  onOpen={(blobUrl) => setOpenMedia(decryptedImages.indexOf(blobUrl))}
                />
              </div>
            );
          }
          return (
            <PrivateMediaCarousel
              images={images}
              onOpen={(index) => setOpenMedia(index)}
            />
          );
        })()}
        {/* Deliberate divergence from the public counts row: no repost.
            A public kind 6 would leak the sealed rumor, and "reposting"
            privately means re-wrapping for another connection — a share
            feature, not a count. Replies and reactions only. */}
        <div className="text-muted-foreground flex items-center gap-4 pt-1 text-sm">
          {noteHref !== undefined && (
            <ReplyCount
              replies={replyCount ?? 0}
              pending={pending}
              capped={false}
              href={noteHref}
            />
          )}
          <EngagementCount
            icon={<Heart className={cn('size-4', !!user && reactions.some((r) => r.pubkey === user.pubkey) && 'fill-current')} />}
            count={reactions.length}
            capped={false}
            pending={pending}
            mine={!!user && reactions.some((r) => r.pubkey === user.pubkey)}
            tab="reactions"
            reactions={reactions as readonly EngagementRow[]}
            reposts={[]}
            choices={config.reactionChoices}
            onEngage={() => onReact?.(rumor, config.defaultReaction)}
            onChoose={(emoji) => onReact?.(rumor, emoji)}
            ariaLabel="react"
          />
        </div>
      </Note>
      {openMedia !== null && decryptedImages[openMedia] && (
        <Lightbox
          urls={decryptedImages}
          index={openMedia}
          onIndex={setOpenMedia}
          onClose={() => setOpenMedia(null)}
          alt="decrypted image"
          grade="private"
        />
      )}
      {edited && (
        <EditHistoryDialog versions={chain} open={historyOpen} onOpenChange={setHistoryOpen} />
      )}
    </>
  );
};

export const ReplyComposer = ({
  parent,
  onReply,
}: {
  parent: OpenedNote;
  onReply: (parent: OpenedNote, content: string, media?: readonly StagedImage[], previews?: readonly string[]) => void;
}) => {
  const [draft, setDraft] = useState('');
  const { attachments, addFiles, remove: removeAttachment, clear } = useAttachments();
  const prepImages = usePrivateImagePrep();
  const [prepping, setPrepping] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  // Submit encrypts the staged images under the conversation's reply
  // CEK — local, fast — then hands the reply to the broadcast flow: the
  // ciphertext leaves only when the modal confirms. A prep failure
  // stays on screen; the staged files are never dropped silently.
  const submit = () => {
    const content = draft.trim();
    if ((!content && attachments.length === 0) || prepping) return;
    setPrepError(null);
    setPrepping(true);
    void (async () => {
      try {
        const media = attachments.length > 0
          ? await prepImages(parent.replyCek, attachments.map((a) => a.file))
          : [];
        onReply(parent, content, media, attachments.map((a) => a.previewUrl));
        setDraft('');
        clear();
      } catch (e) {
        setPrepError(e instanceof Error ? e.message : String(e));
      } finally {
        setPrepping(false);
      }
    })();
  };

  return (
    <>
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        busy={prepping}
        variant="reply"
        grade="private"
        attachments={attachments}
        onAddFiles={addFiles}
        onRemoveAttachment={removeAttachment}
      />
      {prepError && (
        <p className="text-red-500 px-1 pt-1 text-xs">prep failed: {prepError}</p>
      )}
    </>
  );
};

/**
 * The sealed replies of one note plus its composer — the exact list the
 * thread page indents under the root and the panes show on their own,
 * so their wiring (history chains, reactions, edits) exists once.
 * `onOpenReply`/`anchorId` are column extras: absent on the thread page.
 */
export const SealedReplies = ({
  note,
  replies,
  conversation,
  pending,
  onReply,
  onReact,
  onEditReply,
  anchorId,
  onOpenReply,
}: {
  note: OpenedNote;
  replies: readonly OpenedReply[];
  conversation: Conversation;
  /** Counts show their loading state until the conversation arrives. */
  pending?: boolean;
  onReply: (parent: OpenedNote, content: string, media?: readonly StagedImage[], previews?: readonly string[]) => void;
  onReact?: (parent: OpenedNote, target: Rumor, emoji: string) => void;
  onEditReply?: (parent: OpenedNote, reply: OpenedReply, content: string) => void;
  anchorId?: string;
  onOpenReply?: (reply: OpenedReply) => void;
}) => (
  <>
    {replies.map((reply) => (
      <div key={reply.wrapper.id} className="space-y-3">
        <PrivateItem
          rumor={reply.rumor}
          wrapper={reply.wrapper}
          replyCek={note.replyCek}
          conversation={conversation}
          versions={[...(reply.history?.map((h) => h.rumor) ?? []), reply.rumor]}
          pending={pending}
          anchored={anchorId !== undefined ? anchorId === reply.rumor.id : undefined}
          onOpen={onOpenReply ? () => onOpenReply(reply) : undefined}
          onReact={onReact ? (target, emoji) => onReact(note, target, emoji) : undefined}
          onEdit={onEditReply ? (content) => onEditReply(note, reply, content) : undefined}
        />
      </div>
    ))}
    <ReplyComposer parent={note} onReply={onReply} />
  </>
);

/**
 * One private post, behaving exactly like a public one: in the feed it
 * shows just the note with a reply count that routes to its thread page;
 * opened (the thread page), the replies indent under it thread-style and
 * the reply composer appears. Every item — post or reply — renders
 * through the same Note component the public feed uses, its media tags
 * as decrypted images under the body.
 */
export const PrivateNote = ({
  note,
  history,
  replies,
  conversation,
  open,
  pending,
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
  /** Counts show their loading state until the conversation arrives. */
  pending?: boolean;
  onReply: (parent: OpenedNote, content: string, media?: readonly StagedImage[], previews?: readonly string[]) => void;
  onReact?: (parent: OpenedNote, target: Rumor, emoji: string) => void;
  onEdit?: (parent: OpenedNote, content: string) => void;
  onEditReply?: (parent: OpenedNote, reply: OpenedReply, content: string) => void;
  onDelete?: (parent: OpenedNote, history: readonly OpenedNote[]) => void;
}) => (
  <div className="space-y-3">
    <PrivateItem
      rumor={note.rumor}
      wrapper={note.wrapper}
      replyCek={note.replyCek}
      conversation={conversation}
      versions={history.map((h) => h.rumor)}
      replyCount={replies.length}
      noteHref={open ? undefined : `/private-feed/${nip19.neventEncode({ id: note.rumor.id, author: note.rumor.pubkey, relays: [] })}`}
      pending={pending}
      onReact={onReact ? (target, emoji) => onReact(note, target, emoji) : undefined}
      onEdit={onEdit ? (content) => onEdit(note, content) : undefined}
      onDelete={onDelete ? () => onDelete(note, history) : undefined}
    />
    {open && (
      <div className="space-y-3 border-l pl-3">
        <SealedReplies
          note={note}
          replies={replies}
          conversation={conversation}
          pending={pending}
          onReply={onReply}
          onReact={onReact}
          onEditReply={onEditReply}
        />
      </div>
    )}
  </div>
);
