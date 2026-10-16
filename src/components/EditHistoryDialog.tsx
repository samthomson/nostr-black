import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { diffLines, type DiffRow, type DiffSegment } from '@/lib/diff';
import { formatTimestamp } from '@/lib/format';
import type { Rumor } from '@/lib/feedEncryption';
import { cn } from '@/lib/utils';

/** Intra-line runs: deletions red-struck, additions green. */
const Mark = ({ seg }: { seg: DiffSegment }) => {
  if (seg.op === 'add') {
    return <span className="bg-diff-add/20 text-diff-add rounded-xs px-0.5">{seg.text}</span>;
  }
  if (seg.op === 'del') {
    return <span className="bg-diff-del/20 text-diff-del rounded-xs px-0.5 line-through">{seg.text}</span>;
  }
  return <>{seg.text}</>;
};

/** One side's intra-line runs: deletions on the left, additions on the right. */
const sideRuns = (row: DiffRow, side: 'left' | 'right'): React.ReactNode => {
  if (row.kind === 'change' && row.segments) {
    const keep = side === 'left' ? 'del' : 'add';
    return row.segments
      .filter((s) => s.op === keep || s.op === 'same')
      .map((s, i) => <Mark key={i} seg={s} />);
  }
  if (side === 'left') {
    return row.kind === 'del'
      ? <span className="text-diff-del">{row.left}</span>
      : <span>{row.left}</span>;
  }
  return row.kind === 'add'
    ? <span className="text-diff-add">{row.right}</span>
    : <span>{row.right}</span>;
};

const cell = 'min-h-[1.5rem] whitespace-pre-wrap break-words px-2 py-0.5 text-sm';

/** One diff row, side by side: old on the left, new on the right. */
const Row = ({ row }: { row: DiffRow }) => (
  <>
    <div className={cn(cell, 'border-r border-border/60', (row.kind === 'del' || row.kind === 'change') && 'bg-diff-del/10')}>
      {sideRuns(row, 'left')}
    </div>
    <div className={cn(cell, (row.kind === 'add' || row.kind === 'change') && 'bg-diff-add/10')}>
      {sideRuns(row, 'right')}
    </div>
  </>
);

/** One version: the original renders plain; each later one as a side-by-side diff. */
const Version = ({ index, prev, curr }: { index: number; prev?: Rumor; curr: Rumor }) => {
  const rows = prev ? diffLines(prev.content, curr.content) : null;
  return (
    <div className={index > 0 ? 'border-t border-border' : ''}>
      <div className="text-muted-foreground flex items-baseline gap-2 px-3 py-2 text-xs">
        <span className="text-foreground font-medium">{index === 0 ? 'original' : `edit ${index}`}</span>
        <span>{formatTimestamp(curr.created_at)}</span>
      </div>
      <div className="px-3 pb-3">
        {rows ? (
          <div data-testid="diff-grid" className="grid grid-cols-2 overflow-hidden rounded-sm border border-border">
            {rows.map((row, i) => (
              <Row key={i} row={row} />
            ))}
          </div>
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm">{curr.content}</div>
        )}
      </div>
    </div>
  );
};
/** A note's edit history, oldest first, each edit diffed against its parent. */
export const EditHistoryDialog = ({
  versions,
  open,
  onOpenChange,
}: {
  versions: readonly Rumor[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[85dvh] max-w-[95vw] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle className="text-lg font-semibold">edit history</DialogTitle>
      </DialogHeader>
      <div className="overflow-hidden rounded-sm border border-border">
        {versions.map((curr, i) => (
          <Version key={curr.id} index={i} prev={i > 0 ? versions[i - 1] : undefined} curr={curr} />
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
