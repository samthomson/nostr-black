import { ListFilter } from 'lucide-react';
import { useAppContext } from '@/hooks/useAppContext';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FEED_KINDS } from '@/data/feed/spec';

const FEED_KIND_LABELS: Record<number, string> = {
  1: 'note',
  6: 'repost',
  16: 'generic repost',
  20: 'picture',
  21: 'video',
  1063: 'file',
  30023: 'long-form',
};

/**
 * Feed-kind toggles in the feed header. Each kind is independent; disabling
 * one re-queries the follows feed without it. Persisted in app config.
 */
export const FeedKindMenu = () => {
  const { config, updateConfig } = useAppContext();
  const enabled = new Set(config.feedKinds);

  const toggle = (kind: number) => {
    const next = config.feedKinds.includes(kind)
      ? config.feedKinds.filter((k) => k !== kind)
      : [...config.feedKinds, kind];
    updateConfig((current) => ({ ...current, feedKinds: next }));
  };

  const filtered = config.feedKinds.length < FEED_KINDS.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="feed kinds"
          className="relative h-8 w-8 text-muted-foreground hover:text-foreground"
        >
          <ListFilter className="size-4" />
          {filtered && (
            <span className="bg-primary absolute top-1 right-1 size-1.5 rounded-sm" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>feed kinds</DropdownMenuLabel>
        {FEED_KINDS.map((kind) => (
          <DropdownMenuCheckboxItem
            key={kind}
            checked={enabled.has(kind)}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={() => toggle(kind)}
          >
            <span className="flex-1">{FEED_KIND_LABELS[kind]}</span>
            <span className="text-muted-foreground text-xs">kind {kind}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
