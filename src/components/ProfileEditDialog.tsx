import { useState } from 'react';
import { nowSec } from '@/lib/timestamp';
import { diffText, type DiffSegment } from '@/lib/diff';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useProfile } from '@/data/hooks/useProfile';
import { useRouting } from '@/data/hooks/useRouting';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { DEFAULT_DISCOVERY_RELAYS } from '@/lib/appRelays';
import { clientTag } from '@/lib/clientTag';
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
 * field: label, old value, new value.
 */
const ProfileDiff = ({
  fields,
  old,
  next,
}: {
  fields: readonly string[];
  old: Record<string, string>;
  next: Record<string, string>;
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
  </div>
);

/** One labeled input row. */
const Field = ({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) => (
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
      <input
        aria-label={label}
        className="block w-full rounded-sm border bg-transparent px-2 py-1.5 text-sm outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
    )}
  </label>
);

/**
 * Profile editing on the profile page. The new kind 0 is the current
 * content with edited fields overlaid — unknown fields from other apps
 * pass through untouched (see `editedProfileContent`). Malformed current
 * content blocks saving rather than risking a rewrite. Saving opens the
 * standard broadcast modal; confirmation signs and enqueues.
 */
export const ProfileEditDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { user } = useCurrentUser();
  const { myWrite } = useRouting();
  const { metadata, event, pending } = useProfile(user?.pubkey);
  const { request, dialog } = useBroadcastFlow();

  // The form seeds from the fetched metadata once it arrives and stays
  // user-owned afterwards: a late fetch must never clobber typing.
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [seededFrom, setSeededFrom] = useState<string | undefined>(undefined);
  if (event && event.id !== seededFrom) {
    setSeededFrom(event.id);
    setDrafts(draftsWith(metadata as Record<string, unknown> | undefined));
  }

  const set = (field: string) => (value: string) =>
    setDrafts((current) => ({ ...(current ?? draftsWith(undefined)), [field]: value }));

  if (!user) return null;

  const current = draftsWith(metadata as Record<string, unknown> | undefined);
  const form = drafts ?? current;
  const dirty = EDITABLE_PROFILE_FIELDS.some((f) => form[f] !== current[f]);
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

  const save = () => {
    if (!mergeable) return;
    const edits = Object.fromEntries(EDITABLE_PROFILE_FIELDS.map((f) => [f, form[f]]));
    const result = editedProfileContent(event?.content ?? '', edits);
    if (!result.ok || result.changed.length === 0) return;

    void (async () => {
      const tags: string[][] = [];
      const tag = clientTag();
      if (tag) tags.push(['client', tag]);
      const profile = await user.signer.signEvent({
        kind: 0,
        content: result.content,
        tags,
        created_at: nowSec(),
      });
      request({
        grade: 'public',
        label: 'profile',
        identityPubkey: user.pubkey,
        relays: myWrite,
        extraRelays: DEFAULT_DISCOVERY_RELAYS.filter((url) => !myWrite.includes(url)),
        events: [profile],
        // Enqueue is the commit point: the edit is on its way, close the
        // editor so the profile page is what's left on screen.
        onEnqueued: () => onOpenChange(false),
        // A profile edit is not a note: the modal body is a git-style
        // diff of the changed fields — the same visual language as the
        // edit-history dialog — not the text tabs.
        preview: <ProfileDiff fields={result.changed} old={current} next={form} />,
      });
    })();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
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
              <Field label="picture url" value={form.picture} onChange={set('picture')} />
              <Field label="banner url" value={form.banner} onChange={set('banner')} />
            </div>
            <Field label="about" value={form.about} onChange={set('about')} multiline />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={save} disabled={!dirty || pending || !mergeable}>
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
                  onOpenChange(false);
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
