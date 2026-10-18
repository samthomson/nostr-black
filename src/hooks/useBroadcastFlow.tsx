import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BroadcastDialog } from '@/components/BroadcastDialog';
import type { EventLayer } from '@/lib/feedEncryption';
import { enqueue } from '@/data/publish/queue';
import type { PrivacyGrade } from '@/lib/privacy';
import type { NostrEvent } from '@nostrify/nostrify';

/** One uploaded file, as buildEvents references it. */
export interface UploadedFile {
  url: string;
  sha256: string;
  mime: string;
}

/** Blossom uploads deferred until the user confirms: nothing leaves
 * the device before the broadcast button. `run` sends the bytes,
 * `buildEvents` then builds the events that reference the returned
 * urls. `signUploadsWith` signs the kind-24242 blossom auth — private
 * uploads use a throwaway key, public ones the note signer. */
export interface PendingUploads {
  count: number;
  server: string;
  /** Local blob urls of the staged files — the modal preview shows the
   *  pictures before the upload has run and produced real urls. */
  previews?: readonly string[];
  signUploadsWith?: Uint8Array;
  run: () => Promise<UploadedFile[]>;
}

/** One broadcast, previewed and awaiting confirmation. */
export interface PendingBroadcast {
  grade: PrivacyGrade;
  label: string;
  /** Text payload: shown (and editable when `onEdit` exists) as the
   *  note body. Omitted by non-text broadcasts, which pass `preview`. */
  content?: string;
  /** Structured preview body for non-text broadcasts (profile edits,
   *  reactions, deletions): rendered instead of the text tabs. */
  preview?: ReactNode;
  identityPubkey: string;
  identityNote?: string;
  relays: readonly string[];
  /** Signed events; enqueued when the user confirms. Exactly one of
   *  `events` / `uploads`+`buildEvents` is present: either everything
   *  is built upfront, or the uploads run first on confirm and the
   *  events build from the urls they return. */
  events?: readonly NostrEvent[];
  /** Decoded layers for the event tab (wrapper / seal / rumour). */
  layers?: readonly EventLayer[];
  /** Labels per event when there are several (chunks): defaults to label. */
  labels?: readonly string[];
  uploads?: PendingUploads;
  buildEvents?: (uploaded: readonly UploadedFile[]) => readonly NostrEvent[] | Promise<readonly NostrEvent[]>;
  controls?: ReactNode;
  /** Present when the payload is revisable text: re-signs/re-wraps and
   *  re-previews as it changes, so the queued events always match. */
  onEdit?: (content: string) => void;
  /** Secondary targets behind the discovery toggle. */
  extraRelays?: readonly string[];
  /** Called when the user confirms and the events are enqueued — the
   *  moment surfaces clear their inputs (draft, burner state). */
  onEnqueued?: () => void;
}

/**
 * The app-wide broadcast flow: `request(pending)` opens the standard
 * modal; confirmation enqueues the signed events. Every publishing
 * surface uses this — the modal is the one UX, and the one gate: with
 * deferred uploads, no bytes leave the device before it confirms.
 */
export const useBroadcastFlow = (): {
  request: (pending: PendingBroadcast) => void;
  dialog: ReactNode;
  /** The preview currently open, if any. */
  pending: PendingBroadcast | null;
} => {
  const [pending, setPendingState] = useState<PendingBroadcast | null>(null);
  /** Mirrors pending for liveness checks inside async upload chains —
   * a cancel swaps it to null and the resolved chain drops its result. */
  const pendingRef = useRef<PendingBroadcast | null>(null);
  const setPending = (next: PendingBroadcast | null): void => {
    pendingRef.current = next;
    setPendingState(next);
  };
  const [busy, setBusy] = useState(false);
  /** Which step of an upload+broadcast run is live — the modal shows
   * "1/2 uploading…" then "2/2 broadcasting…" so the button press has
   * visible progress instead of a silent disabled beat. */
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'broadcasting'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const request = useCallback((next: PendingBroadcast) => {
    setUploadError(null);
    setPhase('idle');
    setPending(next);
  }, []);

  const broadcast = (targets: readonly string[]) => {
    if (!pending || busy) return;
    // Liveness: a cancel while the deferred upload runs closes the
    // modal (setPending(null)) — the resolved chain must then drop the
    // result instead of publishing a broadcast the user cancelled.
    const live = pending;
    const stillLive = (): boolean => pendingRef.current === live;
    const commit = (events: readonly NostrEvent[]): void => {
      events.forEach((event, i) =>
        enqueue(live.labels?.[i] ?? live.label, event, [...targets]));
      live.onEnqueued?.();
      setBusy(false);
      setPending(null);
    };
    if (!live.uploads || !live.buildEvents) {
      commit(live.events ?? []);
      return;
    }
    // Deferred uploads: the bytes go up first, then the events build
    // from the real urls. An upload failure keeps the modal open with
    // the error — retry or cancel, never a silent drop. Between the two
    // steps the modal holds one readable beat on "broadcasting" so the
    // user sees both halves happened.
    setUploadError(null);
    setBusy(true);
    setPhase('uploading');
    void live.uploads.run()
      .then((uploaded) => Promise.resolve(live.buildEvents!(uploaded)))
      .then((events) => {
        if (!stillLive()) return;
        setPhase('broadcasting');
        setTimeout(() => { if (stillLive()) commit(events); }, 600);
      })
      .catch((e: unknown) => {
        setBusy(false);
        if (stillLive()) setUploadError(e instanceof Error ? e.message : String(e));
      });
  };

  const dialog = pending ? (
    <BroadcastDialog
      open
      onOpenChange={(open) => { if (!open) setPending(null); }}
      error={uploadError}
      busy={busy}
      phase={phase}
      grade={pending.grade}
      label={pending.label}
      content={pending.content}
      preview={pending.preview}
      identityPubkey={pending.identityPubkey}
      identityNote={pending.identityNote}
      relays={pending.relays}
      controls={pending.controls}
      onEdit={pending.onEdit}
      layers={pending.layers ?? pending.events?.map((event) => ({ name: 'event', decoded: event })) ?? []}
      extraRelays={pending.extraRelays}
      uploads={pending.uploads ? { count: pending.uploads.count, server: pending.uploads.server, previews: pending.uploads.previews } : undefined}
      onBroadcast={broadcast}
    />
  ) : null;

  return { request, dialog, pending };
};
