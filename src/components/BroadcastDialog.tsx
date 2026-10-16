import { Radio } from 'lucide-react';
import { useState } from 'react';
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

/**
 * The one broadcast modal. Structure:
 *
 * - header: what + grade pill;
 * - the note: preview/event tabs, colour-swatched with a soft gradient
 *   edge so the grade reads without clashing with the modal chrome;
 * - the note's config: structured `label: value` rows — route, relays
 *   (discovery greyed until toggled), identity;
 * - footer: broadcast.
 */
export const BroadcastDialog = ({
  open,
  onOpenChange,
  grade,
  label,
  preview,
  layers,
  identityPubkey,
  identityNote,
  relays,
  extraRelays,
  controls,
  onBroadcast,
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  grade: PrivacyGrade;
  label: string;
  preview: ReactNode;
  layers: readonly EventLayer[];
  identityPubkey: string;
  identityNote?: string;
  relays: readonly string[];
  extraRelays?: readonly string[];
  controls?: ReactNode;
  onBroadcast: (targets: readonly string[]) => void;
  busy?: boolean;
}) => {
  const burner = identityNote === 'burner';
  const { metadata } = useProfile(burner ? undefined : identityPubkey);
  const displayName = metadata?.display_name || metadata?.name;
  const onTor = useIsTor();
  const [tab, setTab] = useState<'preview' | 'event'>('preview');
  const [layer, setLayer] = useState(0);
  const [withDiscovery, setWithDiscovery] = useState(false);
  const targets = withDiscovery && extraRelays
    ? [...new Set([...relays, ...extraRelays])]
    : relays;
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
            {(['preview', 'event'] as const).map((id) => (
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

          {/* The note content. */}
          <div className="max-h-44 overflow-y-auto px-3 pt-1.5 pb-2">
            {tab === 'preview' ? (
              <div className="text-sm break-words whitespace-pre-wrap">{preview}</div>
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

            <DraftRow label="relays">
              <div className="flex min-w-0 flex-wrap gap-1">
                {relays.map((url) => <RelayPill key={url} url={url} />)}
                {extraRelays?.map((url) => (
                  <RelayPill key={url} url={url} dimmed={!withDiscovery} />
                ))}
              </div>
              {extraRelays && extraRelays.length > 0 && (
                <div className="w-full">
                  <DraftSwitch on={withDiscovery} onToggle={() => setWithDiscovery(!withDiscovery)} label="discovery" />
                </div>
              )}
            </DraftRow>

            <DraftRow label="as">
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <Chip>{burner ? 'burner' : (displayName ?? 'anon')}</Chip>
                <Chip>{shortNpub(identityPubkey, 24)}</Chip>
                {!burner && identityNote && (
                  <span className="font-mono text-[10px] leading-none opacity-50">{identityNote}</span>
                )}
              </div>
              {controls && <div className="w-full">{controls}</div>}
            </DraftRow>
          </div>
        </div>

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
            broadcast
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
 * The one switch used inside the draft: discovery, burner — any
 * boolean. Same size as the chips (font-mono text-[10px]), same
 * fg-tint, so the grid reads as one system.
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

/** npub eclipsed in the middle: keep the readable start and the
 * discriminating end, drop only as many middle chars as needed. */
const shortNpub = (pubkey: string, max = 20): string => {
  const npub = npubOf(pubkey);
  return npub.length <= max ? npub : `${npub.slice(0, Math.ceil((max - 1) / 2))}…${npub.slice(-Math.floor((max - 1) / 2))}`;
};