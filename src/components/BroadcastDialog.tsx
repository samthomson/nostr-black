import { Loader2, Radio, RefreshCw } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { generateSecretKey } from 'nostr-tools';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PrivacyTag } from '@/components/PrivacyTag';
import { useProfile } from '@/data/hooks/useProfile';
import { npubOf } from '@/lib/format';
import { Chip, RelayPill, RoutePill } from '@/components/Pills';
import { useIsTor } from '@/hooks/useEgress';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';
import type { PrivacyGrade } from '@/lib/privacy';
import type { ReactNode } from 'react';
import type { EventLayer } from '@/lib/feedEncryption';
import type { PendingBroadcast } from '@/hooks/useBroadcastFlow';

/**
 * The one broadcast modal. Structure:
 *
 * - header: what + grade pill;
 * - the note: preview/event tabs, colour-swatched with a soft gradient
 *   edge so the grade reads without clashing with the modal chrome;
 * - the note's config: structured `label: value` rows — route, relays
 *   (each an on/off switch), identity;
 * - footer: broadcast.
 */
export const BroadcastDialog = ({
  open,
  onOpenChange,
  grade,
  label,
  layers,
  setBurner,
  identityPubkey,
  identityNote,
  relays,
  extraRelays,
  content,
  preview,
  uploads,
  error,
  onEdit,
  onRepreview,
  onBroadcast,
  busy = false,
  phase = 'idle',
  progress = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grade: PrivacyGrade;
  label: string;
  content?: string;
  /** Structured preview for non-text broadcasts (profile edits,
   *  reactions, deletions): rendered instead of the text tabs. */
  preview?: ReactNode;
  layers: readonly EventLayer[];
  identityPubkey: string;
  identityNote?: string;
  relays: readonly string[];
  extraRelays?: readonly string[];
  setBurner?: (sk: Uint8Array | null) => PendingBroadcast | Promise<PendingBroadcast>;
  error?: string | null;
  onEdit?: (content: string) => void;
  /** Swap in a re-signed draft after a burner change (or edit) — the
   *  flow's request() re-opens the modal on the next pending. */
  onRepreview: (pending: PendingBroadcast) => void;
  /** Deferred blossom uploads, stated in the config rows and the CTA:
   * they run on confirm — the button says "upload … + broadcast" and
   * the step line narrates the run. */
  uploads?: { count: number; server: string; previews?: readonly string[] };
  /** Which half of an upload+broadcast run is live. */
  phase?: 'idle' | 'uploading' | 'broadcasting';
  /** Live upload progress: images done/total plus the current image's
   *  bytes sent — the bar under the step line. */
  progress?: { done: number; total: number; loaded: number; fileBytes: number } | null;
  onBroadcast: (targets: readonly string[]) => void;
  /** A run is in flight — the footer locks. */
  busy?: boolean;
}) => {
  // The standard burner switch below: present only when the caller
  // supplied `setBurner` — the identity is a choice for this broadcast.
  const burnerOn = identityNote === 'burner';
  const { metadata } = useProfile(burnerOn ? undefined : identityPubkey);
  const displayName = metadata?.display_name || metadata?.name;
  const onTor = useIsTor();
  // A text payload (content + optional edit tab) and a structured preview
  // are mutually exclusive: one broadcast, one body. A structured preview
  // needs no tab switcher at all — it is the body; the raw event stays
  // one chip away, opt-in like everywhere else.
  const tabs: readonly ('edit' | 'preview' | 'event')[] = preview
    ? ['preview', 'event']
    : onEdit
      ? ['edit', 'preview', 'event']
      : ['preview', 'event'];
  const [tab, setTab] = useState<'edit' | 'preview' | 'event'>('preview');

  /** Each switch to the edit tab mounts a fresh editor: focus it with the
   * caret after the last character — appending is the common case. Stable
   * identity, so live re-previews while typing never move the caret. */
  const editorRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const [layer, setLayer] = useState(0);
  // The relay row, deduped and in the caller's order. Every relay is a
  // per-relay switch: tap to drop it from (or add it back to) the
  // broadcast — the discovery set arrives dimmed, off by default.
  const initial = [...new Set([...relays, ...(extraRelays ?? [])])];
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(
    () => new Set((extraRelays ?? []).filter((url) => !relays.includes(url))),
  );
  const targets = initial.filter((url) => !excluded.has(url));
  // The standard burner switch: the modal owns the identity choice —
  // toggle and rotate re-sign via the caller's `setBurner`. Last toggle
  // wins: a slow async re-sign drops out when a newer one was requested.
  const signSeq = useRef(0);
  const signAs = (key: Uint8Array | null): void => {
    if (!setBurner) return;
    const seq = ++signSeq.current;
    void Promise.resolve(setBurner(key)).then((next) => {
      if (seq === signSeq.current) onRepreview(next);
    });
  };
  const onBurnerToggle = () => signAs(burnerOn ? null : generateSecretKey());
  const onBurnerRotate = () => signAs(generateSecretKey());
  const style = PRIVACY[grade];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="flex shrink-0 flex-row items-center gap-2 pr-10 px-4 pt-4 pb-2">
          <Radio className="size-4" />
          <DialogTitle className="truncate text-sm leading-none font-semibold tracking-tight">
            {label}
          </DialogTitle>
          <PrivacyTag grade={grade} className="ml-1" />
        </DialogHeader>

        {/* The whole draft: note + config, one coloured surface — the
            grade colour is the draft, so everything inside it adapts
            (fg-based tints, no theme-coloured chrome mixed in). */}
        <div
          className="mx-4 shrink-0 overflow-hidden rounded-sm"
          style={{
            background: `linear-gradient(160deg, ${style.bg} 0%, color-mix(in srgb, ${style.bg} 82%, var(--background)) 100%)`,
            color: style.fg,
            boxShadow: 'inset 0 0 0 1px color-mix(in srgb, currentColor 12%, transparent)',
          }}
        >
          {/* View switcher: small chips, right-aligned, unobtrusive. */}
          <div className="flex justify-end gap-1 px-3 pt-2">
            {tabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className="cursor-pointer rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-none transition-opacity"
                style={{
                  backgroundColor: tab === id
                    ? 'color-mix(in srgb, currentColor 18%, transparent)'
                    : undefined,
                  opacity: tab === id ? 1 : 0.5,
                }}
              >
                {id}
              </button>
            ))}
          </div>
          {/* The body: a structured preview for non-text broadcasts, the
              text tabs (edit/preview/event) for text payloads. */}
          <div className="h-44 overflow-y-auto px-3 pt-1.5 pb-2">
            {preview && tab === 'preview' ? (
              <div className="text-sm">{preview}</div>
            ) : tab === 'preview' ? (
              <div className="space-y-2">
                {content && <div className="text-sm break-words whitespace-pre-wrap">{content}</div>}
                {uploads?.previews && uploads.previews.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {uploads.previews.map((url) => (
                      <img
                        key={url}
                        src={url}
                        alt=""
                        className="max-h-36 rounded-sm border object-cover"
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : tab === 'edit' ? (
              <textarea
                ref={editorRef}
                value={content}
                onChange={(e) => onEdit!(e.target.value)}
                aria-label="edit note"
                spellCheck={false}
                className="block h-full w-full resize-none bg-transparent text-sm outline-none"
              />
            ) : (
              <div className="space-y-1.5">
                {layers.length > 1 && (
                  <div className="flex flex-wrap gap-1">
                    {layers.map((l, i) => (
                      <button
                        key={l.name}
                        type="button"
                        role="tab"
                        aria-selected={layer === i}
                        onClick={() => setLayer(i)}
                        className="cursor-pointer rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-none transition-opacity"
                        style={{
                          backgroundColor: layer === i
                            ? 'color-mix(in srgb, currentColor 15%, transparent)'
                            : undefined,
                          opacity: layer === i ? 1 : 0.5,
                        }}
                      >
                        {l.name}
                      </button>
                    ))}
                  </div>
                )}
                <pre className="font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap">
                  {JSON.stringify(layers[layer]?.decoded, null, 4)}
                </pre>
              </div>
            )}
          </div>

          {/* The config — table-aligned label/value rows. ONE font size
              for every element (chips, labels, toggles, identity): the
              chips carry the mono metadata, the toggles and names match
              them. Values can wrap to new lines but stay in the value
              column. */}
          <div
            className="space-y-1.5 px-3 pt-2 pb-3"
            style={{ borderTop: '1px solid color-mix(in srgb, currentColor 12%, transparent)' }}
          >
            <DraftRow label="via">
              <RoutePill route={onTor ? 'tor' : 'direct'} />
            </DraftRow>

            {uploads && (
              <DraftRow label="upload">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <span className="font-mono text-[10px] leading-none">
                    {uploads.count} image{uploads.count === 1 ? '' : 's'} →
                  </span>
                  <RelayPill url={uploads.server} />
                </div>
              </DraftRow>
            )}

            <DraftRow label="relays">
              <div className="flex min-w-0 flex-wrap gap-1">
                {initial.map((url) => (
                  <RelayPill
                    key={url}
                    url={url}
                    dimmed={excluded.has(url)}
                    onToggle={() => setExcluded((prev) => {
                      const next = new Set(prev);
                      if (next.has(url)) next.delete(url);
                      else next.add(url);
                      return next;
                    })}
                  />
                ))}
              </div>
            </DraftRow>

            <DraftRow label="as">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                {identityNote === 'burner-signed' ? (
                  // A sealed broadcast has two faces: relays see a burner,
                  // the connections who open it see you.
                  <>
                    <Chip>burner</Chip>
                    <span className="font-mono text-[10px] leading-none opacity-50">publicly ·</span>
                    <Chip>{shortNpub(identityPubkey, 24)}</Chip>
                    <span className="font-mono text-[10px] leading-none opacity-50">to connections</span>
                  </>
                ) : (
                  <>
                    <Chip>{burnerOn ? 'burner' : (displayName ?? 'anon')}</Chip>
                    <Chip>{shortNpub(identityPubkey, 24)}</Chip>
                    {!burnerOn && identityNote && (
                      <span className="font-mono text-[10px] leading-none opacity-50">{identityNote}</span>
                    )}
                  </>
                )}
              </div>
              {setBurner && (
                <div className="flex flex-wrap items-center gap-4">
                  <DraftSwitch on={burnerOn} onToggle={onBurnerToggle} label="burner" ariaLabel="broadcast via a burner" />
                  {burnerOn && (
                    <DraftAction
                      icon={<RefreshCw className="size-3" />}
                      onClick={onBurnerRotate}
                      label="new burner"
                      ariaLabel="generate a new burner key"
                    />
                  )}
                </div>
              )}
            </DraftRow>
          </div>
        </div>

        {error && (
          <div className="shrink-0 space-y-2 px-4 pt-2 font-mono text-[10px] leading-relaxed">
            <p className="text-red-500">upload failed: {error}</p>
            <p className="text-muted-foreground">
              your images are still staged — retry, or cancel to keep editing.
            </p>
          </div>
        )}

        {/* The run, narrated: uploads then broadcast — both visible,
            neither silent. The bar tracks the current image's bytes. */}
        {busy && uploads && (
          <div className="shrink-0 space-y-1.5 px-4 pt-2 font-mono text-[10px] leading-relaxed">
            <p className={phase === 'uploading' ? 'text-foreground' : 'text-muted-foreground'}>
              {phase === 'uploading' ? '›' : '✓'} 1/2 uploading image{uploads.count === 1 ? '' : 's'}…
              {phase === 'uploading' && progress && progress.total > 1 && (
                <span className="text-muted-foreground"> {Math.min(progress.done + 1, progress.total)}/{progress.total}</span>
              )}
            </p>
            {phase === 'uploading' && progress && progress.fileBytes > 0 && (
              <div className="bg-muted h-1.5 w-full overflow-hidden rounded-sm">
                <div
                  className="bg-foreground h-full transition-[width] duration-150"
                  style={{ width: `${Math.round((progress.loaded / progress.fileBytes) * 100)}%` }}
                />
              </div>
            )}
            {phase === 'broadcasting' && (
              <p className="text-foreground">› 2/2 broadcasting {label}…</p>
            )}
          </div>
        )}

        {/* The modal's own footer — separated from the draft by real
            space, not a border. */}
        <div className="flex shrink-0 justify-end gap-2 px-4 pt-4 pb-4">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)} className="h-8">
            cancel
          </Button>
          <Button
            type="button"
            variant="privacy"
            disabled={busy}
            onClick={() => { onBroadcast(targets); }}
            className={cn(PRIVACY_BUTTON, style.className)}
          >
            {busy ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {phase === 'uploading' ? 'uploading…' : 'broadcasting…'}
              </>
            ) : error ? (
              'retry upload + broadcast'
            ) : uploads ? (
              `upload ${uploads.count === 1 ? 'image' : `${uploads.count} images`} + broadcast`
            ) : (
              'broadcast'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * Config row inside the draft. The label column and the value column are
 * the alignment grid; multi-line values (relay chips wrapping, toggles
 * below) stay inside the value column. The value column is a block, not
 * a single flex line, so children can flow.
 */
const DraftRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex gap-2 text-xs">
    <span className="w-10 shrink-0 pt-0.5 text-right font-mono text-[10px] leading-none opacity-50">{label}</span>
    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">{children}</div>
  </div>
);

/**
 * The one switch used inside the draft: burner — any boolean. Same size
 * as the chips (font-mono text-[10px]), same fg-tint, so the grid reads
 * as one system.
 */
export const DraftSwitch = ({
  on,
  onToggle,
  label,
  ariaLabel,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  ariaLabel?: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={ariaLabel ?? label}
    onClick={onToggle}
    className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] leading-none"
  >
    <span
      className="relative h-3 w-5 rounded-full border transition-colors"
      style={{
        borderWidth: 1,
        backgroundColor: on ? 'currentColor' : 'color-mix(in srgb, currentColor 15%, transparent)',
      }}
    >
      <span
        className="absolute top-[1px] h-1.5 w-1.5 rounded-full transition-all"
        style={{
          left: on ? 'calc(100% - 7px)' : '2px',
          backgroundColor: on
            ? 'color-mix(in srgb, var(--background) 85%, currentColor)'
            : 'currentColor',
        }}
      />
    </span>
    <span className="opacity-50">{label}</span>
  </button>
);

/**
 * An action inside the draft (not a state): same size and fg-tint as the
 * switches and chips, with an icon beside its label.
 */
export const DraftAction = ({
  icon,
  onClick,
  label,
  ariaLabel,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  label: string;
  ariaLabel?: string;
}) => (
  <button
    type="button"
    aria-label={ariaLabel ?? label}
    onClick={onClick}
    className="flex cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-none opacity-80 transition-opacity hover:opacity-100"
    style={{ backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent)' }}
  >
    {icon}
    {label}
  </button>
);

/** npub eclipsed in the middle: keep the readable start and the
 * discriminating end, drop only as many middle chars as needed. */
const shortNpub = (pubkey: string, max = 20): string => {
  const npub = npubOf(pubkey);
  return npub.length <= max ? npub : `${npub.slice(0, Math.ceil((max - 1) / 2))}…${npub.slice(-Math.floor((max - 1) / 2))}`;
};