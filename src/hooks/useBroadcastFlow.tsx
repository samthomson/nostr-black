import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { BroadcastDialog, type EventLayer } from '@/components/BroadcastDialog';
import { enqueue } from '@/data/publish/queue';
import type { PrivacyGrade } from '@/lib/privacy';
import type { NostrEvent } from '@nostrify/nostrify';

/** One broadcast, previewed and awaiting confirmation. */
export interface PendingBroadcast {
  grade: PrivacyGrade;
  label: string;
  preview: ReactNode;
  identityPubkey: string;
  identityNote?: string;
  relays: readonly string[];
  /** Signed events; enqueued when the user confirms. */
  events: readonly NostrEvent[];
  /** Decoded layers for the event tab (wrapper / seal / rumour). */
  layers?: readonly EventLayer[];
  /** Labels per event when there are several (chunks): defaults to label. */
  labels?: readonly string[];
  controls?: ReactNode;
  /** Secondary targets behind the discovery toggle. */
  extraRelays?: readonly string[];
  /** Called when the user confirms and the events are enqueued — the
   * moment surfaces clean up their inputs (draft, burner state). */
  onEnqueued?: () => void;
}

/**
 * The app-wide broadcast flow: `request(pending)` opens the standard
 * modal; confirmation enqueues the signed events. Every publishing
 * surface uses this — the modal is the one UX.
 */
export const useBroadcastFlow = (): {
  request: (pending: PendingBroadcast) => void;
  dialog: ReactNode;
  /** The preview currently open, if any. */
  pending: PendingBroadcast | null;
} => {
  const [pending, setPending] = useState<PendingBroadcast | null>(null);

  const request = useCallback((next: PendingBroadcast) => setPending(next), []);

  const broadcast = (targets: readonly string[]) => {
    if (!pending) return;
    pending.events.forEach((event, i) =>
      enqueue(pending.labels?.[i] ?? pending.label, event, [...targets]));
    pending.onEnqueued?.();
    setPending(null);
  };


  const dialog = pending ? (
    <BroadcastDialog
      open
      onOpenChange={(open) => { if (!open) setPending(null); }}
      grade={pending.grade}
      label={pending.label}
      preview={pending.preview}
      identityPubkey={pending.identityPubkey}
      identityNote={pending.identityNote}
      relays={pending.relays}
      controls={pending.controls}
      layers={pending.layers ?? pending.events.map((event) => ({ name: 'event', decoded: event }))}
      extraRelays={pending.extraRelays}

      onBroadcast={broadcast}
    />
  ) : null;

  return { request, dialog, pending };
};
