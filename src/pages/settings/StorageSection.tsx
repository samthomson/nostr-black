import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { nowSec } from '@/lib/timestamp';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRouting } from '@/data/hooks/useRouting';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { useBlossomServers } from '@/data/hooks/useBlossomServers';
import { DEFAULT_BLOSSOM_SERVERS } from '@/lib/appRelays';
import { useAppContext } from '@/hooks/useAppContext';
import { clientTagOf } from '@/lib/clientTag';
import { Button } from '@/components/ui/button';
import { Section } from './Section';

/** https origin of a url string, or undefined when junk. */
const originOf = (value: string): string | undefined => {
  try {
    const withScheme = value.startsWith('https://') ? value : `https://${value}`;
    const url = new URL(withScheme);
    return url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

/** The list diff as the modal's preview: gone red, new green. */
const ServersDiff = ({ old, next }: { old: readonly string[]; next: readonly string[] }) => (
  <div className="space-y-1 font-mono text-xs">
    {old.filter((url) => !next.includes(url)).map((url) => (
      <p key={url} className="bg-diff-del/20 text-diff-del line-through">{url}</p>
    ))}
    {next.filter((url) => !old.includes(url)).map((url) => (
      <p key={url} className="bg-diff-add/20 text-diff-add">{url}</p>
    ))}
  </div>
);

/** One editable server row: a primary badge on the top entry, move up/down
 *  controls to reorder the fallback precedence, remove to drop it entirely. */
const ServerRow = ({
  url,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRemove,
}: {
  url: string;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) => (
  <li className="flex items-center gap-2 border-b py-2 last:border-b-0">
    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>{url}</span>
    {index === 0 && (
      <span className="shrink-0 rounded-sm border border-primary/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
        primary
      </span>
    )}
    <span className="flex shrink-0 items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-6 w-6 p-0"
        onClick={onMoveUp}
        disabled={index === 0}
        aria-label={`move ${url} up`}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-6 w-6 p-0"
        onClick={onMoveDown}
        disabled={index === total - 1}
        aria-label={`move ${url} down`}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
    </span>
    <Button variant="ghost" size="sm" className="text-muted-foreground h-6 px-2" onClick={onRemove}>
      remove
    </Button>
  </li>
);

/** A server the user did not declare but the app still knows about: shown
 *  read-only so the context is honest without pretending it's editable. */
const FallbackRow = ({ url, label }: { url: string; label: string }) => (
  <li className="flex items-center gap-3 py-2 text-muted-foreground">
    <span className="min-w-0 flex-1 truncate font-mono text-xs opacity-70" title={url}>{url}</span>
    <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-60">{label}</span>
  </li>
);

/**
 * Where your images upload: your kind 10063 blossom server list (BUD-03).
 *
 * Only `servers[0]` is used anywhere in the app — it is the single
 * upload target for profile pictures and note images (see
 * `useBlossomServers` / `useBlossomUpload`). The rest of the list is a
 * fallback precedence: if the primary ever fails, the next entry would
 * take over. Servers your NIP-65 relay list also names, and the app
 * default, are shown read-only below — they belong to those sources, not
 * this list.
 */
export const StorageSection = () => {
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const { myWrite } = useRouting();
  const { request, dialog } = useBroadcastFlow();
  const { declared, fromRelayList, event, pending } = useBlossomServers();

  // The working copy seeds from the declared list and re-seeds whenever a
  // fresh kind 10063 lands (your own broadcast ingests locally).
  const [list, setList] = useState<string[]>(declared);
  const [seededFrom, setSeededFrom] = useState<string | undefined>(event?.id);
  if (event?.id !== seededFrom) {
    setSeededFrom(event?.id);
    setList(declared);
  }
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<'idle' | 'enqueued'>('idle');
  const dirty = list.join('\n') !== declared.join('\n');

  const add = () => {
    const origin = originOf(draft);
    if (origin === undefined || list.includes(origin)) return;
    setList((current) => [...current, origin]);
    setDraft('');
  };

  const move = (index: number, direction: -1 | 1) => {
    setList((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const publish = () => {
    const signer = user?.signer;
    if (!user || !signer || !dirty) return;
    void (async () => {
      const tags = list.map((url) => ['server', url] as [string, string]);
      const tag = clientTagOf(config.clientTag, list.join(','));
      if (tag) tags.push(['client', tag]);
      const signed = await signer.signEvent({
        kind: 10063,
        content: '',
        tags,
        created_at: nowSec(),
      });
      request({
        grade: 'public',
        label: 'upload servers',
        identityPubkey: user.pubkey,
        relays: myWrite,
        events: [signed],
        // Enqueue is the commit: "on its way" means it IS on its way,
        // not that the modal opened (a cancel never shows it).
        onEnqueued: () => setState('enqueued'),
        preview: <ServersDiff old={declared} next={list} />,
      });
    })();
  };

  const fallbacks = fromRelayList.map((url) => ({ url, label: 'from relays' }));

  return (
    <div className="space-y-8">
      <Section
        title="upload server"
        hint={
          pending
            ? 'syncing your list…'
            : declared.length > 0
              ? `${declared[0]} is your upload target`
              : 'you have not chosen a server yet'
        }
      >
        <p className="text-muted-foreground text-xs">
          your images upload to the <span className="font-medium text-foreground">primary</span> server.
          the rest of the list is a fallback order — reorder it, and only the primary changes where
          uploads go today.
        </p>
        <ul>
          {list.map((url, index) => (
            <ServerRow
              key={url}
              url={url}
              index={index}
              total={list.length}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              onRemove={() => setList((current) => current.filter((x) => x !== url))}
            />
          ))}
          {fallbacks.length > 0 && (
            <li className="pt-3 text-[10px] uppercase tracking-wide text-muted-foreground">
              also known from your relay list — not editable here
            </li>
          )}
          {fallbacks.map(({ url, label }) => <FallbackRow key={url} url={url} label={label} />)}
          {declared.length === 0 && list.length === 0 && fromRelayList.length === 0 && (
            <>
              <li className="pt-3 text-[10px] uppercase tracking-wide text-muted-foreground">
                using the app default until you add one
              </li>
              {DEFAULT_BLOSSOM_SERVERS.map((url) => <FallbackRow key={url} url={url} label="default" />)}
            </>
          )}
        </ul>

        <div className="flex gap-2 pt-1">
          <input
            aria-label="add upload server"
            placeholder="blossom.example.com"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-sm border bg-transparent px-2 font-mono text-xs outline-none"
            spellCheck={false}
          />
          <Button size="sm" className="h-8" onClick={add}>
            add
          </Button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={publish} disabled={!user || !dirty}>
            publish list
          </Button>
          {dirty && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setList(declared)}
            >
              discard
            </Button>
          )}
          {state === 'enqueued' && !dirty && (
            <span className="text-muted-foreground font-mono text-[10px]">on its way</span>
          )}
        </div>
      </Section>
      {dialog}
    </div>
  );
};
