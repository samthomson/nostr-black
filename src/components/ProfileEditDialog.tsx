import { useRef, useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { nowSec } from '@/lib/timestamp';
import { diffText, type DiffSegment } from '@/lib/diff';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useProfile } from '@/data/hooks/useProfile';
import { useRouting } from '@/data/hooks/useRouting';
import { useBroadcastFlow, type PendingBroadcast } from '@/hooks/useBroadcastFlow';
import { MediaThumb } from '@/components/MediaThumb';
import type { NostrEvent } from '@nostrify/nostrify';
import { clientTagOf } from '@/lib/clientTag';
import { useAppContext } from '@/hooks/useAppContext';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { useSessionKey } from '@/data/hooks/useSessionKey';
import { useBlossomUpload } from '@/hooks/useBlossomUpload';
import { useBlossomServers } from '@/data/hooks/useBlossomServers';
import { UPLOADABLE_IMAGE_ACCEPT, isUploadableImage, prepareImage } from '@/lib/imageCompress';
import {
  EDITABLE_PROFILE_FIELDS,
  editedProfileContent,
} from '@/lib/profileMetadata';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Drafts = Record<string, string>;

const draftsWith = (metadata: Record<string, unknown> | undefined): Drafts =>
  Object.fromEntries(
    EDITABLE_PROFILE_FIELDS.map((field) => [field, (metadata?.[field] as string | undefined) ?? '']),
  );

/** One diff run: green additions, red deletions. */
const DiffMark = ({ seg }: { seg: DiffSegment }) => {
  if (seg.op === 'add') {
    return <span className="bg-diff-add/20 text-diff-add rounded-sm px-0.5">{seg.text}</span>;
  }
  if (seg.op === 'del') {
    return <span className="bg-diff-del/20 text-diff-del line-through">{seg.text}</span>;
  }
  return <>{seg.text}</>;
};

/**
 * The changed fields of a profile edit as a git-style diff — the same
 * green/red language as the edit-history dialog. One row per changed
 * field: label, old value, new value. Staged images diff visually:
 * old thumbnail → new thumbnail, because a url string says nothing.
 */
const ProfileDiff = ({
  fields,
  old,
  next,
  images,
}: {
  fields: readonly string[];
  old: Record<string, string>;
  next: Record<string, string>;
  /** Staged image fields: label, current url (may be empty), local preview. */
  images?: readonly { field: string; currentUrl: string; previewUrl: string }[];
}) => (
  <div className="space-y-2">
    {fields.map((field) => {
      const before = old[field] ?? '';
      const after = next[field] ?? '';
      return (
        <div key={field} className="overflow-hidden rounded-sm border border-current/20">
          <div className="text-muted-foreground bg-current/10 px-2 py-0.5 font-mono text-[10px]">
            {field}
          </div>
          <div className="space-y-0.5 px-2 py-1 text-sm">
            {before !== '' && (
              <div className="text-diff-del">
                -{' '}
                {diffText(before, after)
                  .filter((s) => s.op !== 'add')
                  .map((s, i) => <DiffMark key={i} seg={s} />)}
              </div>
            )}
            {after !== '' && (
              <div className="text-diff-add">
                +{' '}
                {diffText(before, after)
                  .filter((s) => s.op !== 'del')
                  .map((s, i) => <DiffMark key={i} seg={s} />)}
              </div>
            )}
          </div>
        </div>
      );
    })}
    {(images ?? []).map(({ field, currentUrl, previewUrl }) => (
      <div key={field} className="overflow-hidden rounded-sm border border-current/20">
        <div className="text-muted-foreground bg-current/10 px-2 py-0.5 font-mono text-[10px]">
          {field}
        </div>
        <div className="flex items-center gap-3 px-2 py-1.5">
          {currentUrl !== '' ? (
            <MediaThumb url={currentUrl} className="border-diff-del/40 size-10 border" />
          ) : (
            <span className="text-diff-del font-mono text-[10px]">none</span>
          )}
          <span className="text-muted-foreground font-mono text-[10px]">→</span>
          <img
            src={previewUrl}
            alt=""
            className="border-diff-add/60 size-10 rounded-sm border border-dashed object-cover"
          />
          <span className="text-diff-add font-mono text-[10px]">new image</span>
        </div>
      </div>
    ))}
  </div>
);

/** One labeled input row. Image fields (`onFile`) also accept a pick:
 * the paperclip or an image paste stages the file — shown as a dashed
 * local thumbnail (a draft, not saved) with its file name, never as a
 * blob url in the input; the bytes upload with the confirmed
 * broadcast. A pick the app can't upload is named inline. */
const Field = ({
  label,
  value,
  onChange,
  multiline = false,
  onFile,
  staged,
  onUnstage,
  rejectedName,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  /** Present on image fields: stage a file into this field. */
  onFile?: (file: File) => void;
  /** The staged file for this field, if any: name + local preview. */
  staged?: { name: string; preview: string };
  /** Drop the staged file (its preview is revoked by the owner). */
  onUnstage?: () => void;
  /** The last file this field rejected, to show why nothing staged. */
  rejectedName?: string;
}) => {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground font-mono text-[10px]">{label}</span>
      {multiline ? (
        <textarea
          aria-label={label}
          rows={3}
          className="block w-full resize-none rounded-sm border bg-transparent px-2 py-1.5 text-sm outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      ) : (
        <span className={onFile ? 'flex items-center gap-1' : 'block'}>
          <input
            aria-label={label}
            className="block w-full rounded-sm border bg-transparent px-2 py-1.5 text-sm outline-none"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            onPaste={onFile ? (e) => {
              const image = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
              if (image) {
                e.preventDefault();
                onFile(image);
              }
            } : undefined}
          />
          {onFile && (
            <>
              <button
                type="button"
                aria-label={`upload ${label}`}
                className="text-muted-foreground hover:text-foreground flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-sm"
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip className="size-3.5" />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={UPLOADABLE_IMAGE_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onFile(file);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </span>
      )}
      {staged && (
        <span className="flex items-center gap-2 pt-0.5">
          {/* Draft, not saved: dashed outline, slightly translucent. */}
          <img
            src={staged.preview}
            alt=""
            className="border-border size-10 shrink-0 rounded-sm border-dashed object-cover opacity-80"
          />
          <span className="text-muted-foreground truncate font-mono text-[10px]">{staged.name}</span>
          {onUnstage && (
            <button
              type="button"
              aria-label={`remove ${label} file`}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={onUnstage}
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
      )}
      {rejectedName && (
        <span className="text-red-500 truncate font-mono text-[10px]">
          {rejectedName}: not jpg, png, webp or gif
        </span>
      )}
    </label>
  );
};

/**
 * Profile editing on the profile page. The new kind 0 is the current
 * content with edited fields overlaid — unknown fields from other apps
 * pass through untouched (see `editedProfileContent`). Malformed current
 * content blocks saving rather than risking a rewrite. Saving opens the
 * standard broadcast modal; confirmation signs and enqueues — staged
 * images upload there, their urls landing in their fields.
 */
export const ProfileEditDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { request, dialog } = useBroadcastFlow();
  const { user } = useCurrentUser();
  const { myWrite } = useRouting();
  const { metadata, event, pending } = useProfile(user?.pubkey);
  const { config } = useAppContext();
  const sk = useSessionKey();
  const upload = useBlossomUpload();
  const { servers } = useBlossomServers();
  // Picked images, held locally: their bytes compress and upload only
  // when the broadcast confirms, then the returned url takes the
  // field's place in the kind 0. They belong to an open editing
  // session — any close (cancel, enqueue, escape) discards them,
  // previews revoked.
  const [staged, setStaged] = useState<{ field: 'picture' | 'banner'; file: File; previewUrl: string }[]>([]);
  const close = (next: boolean): void => {
    if (!next) {
      for (const s of staged) URL.revokeObjectURL(s.previewUrl);
      setStaged([]);
    }
    onOpenChange(next);
  };

  // The form seeds from the fetched metadata once it arrives and stays
  // user-owned afterwards: a late fetch must never clobber typing.
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [seededFrom, setSeededFrom] = useState<string | undefined>(undefined);
  // An editing session belongs to one open: every reopen re-seeds from
  // the live metadata and discards staged files — a cancelled pick can
  // never survive into a later save.
  const [opened, setOpened] = useState(false);
  if (open && !opened) {
    setOpened(true);
    for (const s of staged) URL.revokeObjectURL(s.previewUrl);
    setStaged([]);
    setDrafts(null);
    setSeededFrom(undefined);
  }
  if (!open && opened) setOpened(false);
  if (event && event.id !== seededFrom) {
    setSeededFrom(event.id);
    setDrafts(draftsWith(metadata as Record<string, unknown> | undefined));
  }

  const set = (field: string) => (value: string) =>
    setDrafts((held) => ({ ...(held ?? draftsWith(undefined)), [field]: value }));

  /** A paste/pick the app can't upload — named, never silent. */
  const [rejected, setRejected] = useState<{ field: 'picture' | 'banner'; name: string } | null>(null);

  if (!user) return null;


  const stageInto = (field: 'picture' | 'banner') => (file: File) => {
    if (!sk) return;
    // Paste can carry anything the picker wouldn't offer — say so
    // instead of staging a preview that can't render.
    if (!isUploadableImage(file)) {
      setRejected({ field, name: file.name });
      return;
    }
    setRejected(null);
    setStaged((held) => [
      ...held.filter((s) => s.field !== field),
      { field, file, previewUrl: URL.createObjectURL(file) },
    ]);
  };

  /** Drop a staged file and revoke its local preview. */
  const unstage = (field: 'picture' | 'banner') => () => {
    setStaged((held) => {
      for (const s of held.filter((x) => x.field === field)) URL.revokeObjectURL(s.previewUrl);
      return held.filter((x) => x.field !== field);
    });
  };

  /** The staged file of one field as the Field's preview shape. */
  const stagedFor = (field: 'picture' | 'banner') => {
    const s = staged.find((x) => x.field === field);
    return s ? { name: s.file.name, preview: s.previewUrl } : undefined;
  };

  const current = draftsWith(metadata as Record<string, unknown> | undefined);
  const form = drafts ?? current;
  const dirty = staged.length > 0 || EDITABLE_PROFILE_FIELDS.some((f) => form[f] !== current[f]);
  // The current content is the source of truth for the merge; if it can't
  // be parsed, refuse to save rather than risk rewriting the profile.
  const mergeable = (event?.content ?? '').trim() === ''
    || (() => {
      try {
        const parsed: unknown = JSON.parse(event!.content);
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
      } catch {
        return false;
      }
    })();

  /** The kind 0 with every staged field's uploaded url in place — the
   * local preview urls never leave the device. Takes the staged list
   * explicitly: the caller captured it at save time, and the urls line
   * up with THAT list — reading live state here could misassign fields
   * if it changed while the modal was open. */
  const kindZeroOf = async (
    urls: readonly string[],
    stagedNow: readonly { field: string }[],
  ): Promise<readonly NostrEvent[]> => {
    const byField = new Map(stagedNow.map((s, i) => [s.field, urls[i]!]));
    const merged = Object.fromEntries(EDITABLE_PROFILE_FIELDS.map((f) => [f, byField.get(f) ?? form[f]]));
    const built = editedProfileContent(event?.content ?? '', merged);
    if (!built.ok) throw new Error('profile merge failed');
    const tags: string[][] = [];
    const tag = clientTagOf(config.clientTag, built.content);
    if (tag) tags.push(['client', tag]);
    return [await user.signer.signEvent({
      kind: 0,
      content: built.content,
      tags,
      created_at: nowSec(),
    })];
  };

  const save = () => {
    if (!mergeable) return;
    const edits = Object.fromEntries(EDITABLE_PROFILE_FIELDS.map((f) => [f, form[f]]));
    const result = editedProfileContent(event?.content ?? '', edits);
    if (!result.ok || (result.changed.length === 0 && staged.length === 0)) return;

    /** The broadcast preview — one shape for both paths. */
    const requestProfile = (payload: Partial<PendingBroadcast> & { events?: readonly NostrEvent[] }): void =>
      request({
        grade: 'public',
        label: 'profile',
        identityPubkey: user.pubkey,
        relays: myWrite,
        extraRelays: DEFAULT_DISCOVERY_RELAYS.filter((url) => !myWrite.includes(url)),
        // Enqueue is the commit point: the edit is on its way, close the
        // editor so the profile page is what's left on screen.
        onEnqueued: () => close(false),
        // A profile edit is not a note: the modal body is a git-style
        // diff of the changed fields — the same visual language as the
        // edit-history dialog — not the text tabs.
        preview: (
          <ProfileDiff
            fields={result.changed}
            old={current}
            next={form}
            images={staged.map((s) => ({
              field: s.field,
              currentUrl: current[s.field] ?? '',
              previewUrl: s.previewUrl,
            }))}
          />
        ),
        ...payload,
      });

    // The save-time snapshot: the upload run and the kind 0 build both
    // work with THIS list, whatever happens to state while the modal
    // is open.
    const stagedNow = staged;
    if (stagedNow.length === 0) {
      void kindZeroOf([], stagedNow).then((events) => requestProfile({ events }));
      return;
    }
    // Same deferred shape as the note composers: the compressed images
    // upload when the modal confirms, then the kind 0 builds with the
    // returned urls in their fields.
    const server = servers[0]!;
    requestProfile({
      uploads: {
        count: stagedNow.length,
        server,
        signUploadsWith: sk ?? undefined,
        // The session key gates the whole run — without it the blossom
        // auth event can't sign. A clear error here lands in the modal's
        // error line ("upload failed: …"); the assertion instead would
        // surface a TypeError from inside the crypto.
        run: async (onProgress?: (done: number, total: number, loaded: number, fileBytes: number) => void) => {
          if (!sk) throw new Error('logged out — relogin to upload');
          const uploaded: { url: string; sha256: string; mime: string }[] = [];
          for (let i = 0; i < stagedNow.length; i++) {
            const { file } = stagedNow[i]!;
            const compressed = await prepareImage(file, config.imageCompression);
            const blob = await upload(compressed.bytes, compressed.type, sk, server, (loaded, total) => {
              onProgress?.(i, stagedNow.length, loaded, total);
            });
            uploaded.push({ url: blob.url, sha256: blob.sha256, mime: compressed.type });
          }
          return uploaded;
        },
      },
      buildEvents: (uploaded) => kindZeroOf(uploaded.map((file) => file.url), stagedNow),
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-h-[85dvh] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto rounded-sm p-0 sm:max-w-md">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm">edit profile</DialogTitle>
            <DialogDescription className="text-xs">
              your kind 0 metadata — unknown fields from other apps are preserved
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 px-4 pb-4">
            {pending && !drafts && (
              <p className="text-muted-foreground text-xs">loading your profile…</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="display name" value={form.display_name} onChange={set('display_name')} />
              <Field label="name" value={form.name} onChange={set('name')} />
              <Field label="nip05" value={form.nip05} onChange={set('nip05')} />
              <Field label="website" value={form.website} onChange={set('website')} />
              <Field
                label="picture url"
                value={form.picture}
                onChange={set('picture')}
                onFile={stageInto('picture')}
                staged={stagedFor('picture')}
                onUnstage={unstage('picture')}
                rejectedName={rejected?.field === 'picture' ? rejected.name : undefined}
              />
              <Field
                label="banner url"
                value={form.banner}
                onChange={set('banner')}
                onFile={stageInto('banner')}
                staged={stagedFor('banner')}
                onUnstage={unstage('banner')}
                rejectedName={rejected?.field === 'banner' ? rejected.name : undefined}
              />
            </div>
            <Field label="about" value={form.about} onChange={set('about')} multiline />
            <div className="flex items-center gap-2">
              {/* Dirty = there is something to commit: the filled style
                  marks save as THE next action. */}
              <Button
                variant={dirty ? 'default' : 'ghost'}
                size="sm"
                onClick={save}
                disabled={!dirty || pending || !mergeable}
              >
                save profile
              </Button>
              {/* One way out: cancel discards the working copy and closes.
                  The form is re-seeded from the metadata on next open, so
                  there is nothing else "discard" would need to do. */}
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setDrafts(current);
                  close(false);
                }}
              >
                cancel
              </Button>
            </div>
            {!mergeable && (
              <p className="text-destructive text-xs">
                your current profile content can't be parsed — saving is disabled so nothing is
                lost. edit it in the app that wrote it.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {dialog}
    </>
  );
};
