import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PRIVACY, PRIVACY_BUTTON } from '@/lib/privacy';
import { cn } from '@/lib/utils';

/** The inline editor for a note's content: prefill, save, cancel. */
export const NoteEditor = ({
  draft,
  onDraft,
  busy,
  error,
  onSave,
  onCancel,
}: {
  draft: string;
  onDraft: (next: string) => void;
  busy?: boolean;
  error?: string;
  onSave: () => void;
  onCancel: () => void;
}) => (
  <div className="space-y-2">
    <textarea
      value={draft}
      onChange={(e) => onDraft(e.target.value)}
      aria-label="edit note"
      rows={3}
      className="border-input bg-background min-h-[4.5rem] min-w-0 resize-none rounded-sm border px-3 py-2 text-sm"
    />
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="privacy"
        disabled={busy || draft.trim().length === 0}
        onClick={onSave}
        className={cn(PRIVACY_BUTTON, PRIVACY.private.className)}
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : 'save'}
      </Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={onCancel} className="h-8">
        cancel
      </Button>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  </div>
);
