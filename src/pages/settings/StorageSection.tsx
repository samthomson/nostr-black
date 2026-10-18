import { useState } from 'react';
import { nowSec } from '@/lib/timestamp';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useRouting } from '@/data/hooks/useRouting';
import { useBroadcastFlow } from '@/hooks/useBroadcastFlow';
import { useBlossomServers } from '@/data/hooks/useBlossomServers';
import { DEFAULT_BLOSSOM_SERVERS } from '@/lib/appRelays';
import { clientTag } from '@/lib/clientTag';
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

/** One server row: url, a source marker, and a remove control when the
 *  kind 10063 list owns the row. */
const ServerRow = ({
  url,
  source,
  onRemove,
}: {
  url: string;
  source: 'yours' | 'nip-65' | 'default';
  onRemove?: () => void;
}) => (
  <li className="flex items-center gap-3 border-b py-2 last:border-b-0">
    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={url}>{url}</span>
    <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
      {source === 'yours' ? 'first' : source === 'nip-65' ? 'via relays' : 'default'}
    </span>
    {onRemove ? (
      <Button variant="ghost" size="sm" className="text-muted-foreground h-6 px-2" onClick={onRemove}>
        remove
      </Button>
    ) : (
      <span className="text-muted-foreground shrink-0 font-mono text-[10px] opacity-60">—</span>
    )}
  </li>
);

/**
 * Where your images upload: the kind 10063 blossom server list (BUD-03).
 * The first entry is the primary upload target everywhere in the app —
 * profile pictures, note images, the same single resolution order (see
 * `useBlossomServers`). Servers implied by the NIP-65 relay list are
 * shown read-only: they belong to the relay list, not this list.
 */
export const StorageSection = () => {
  const { user } = useCurrentUser();
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

  const publish = () => {
    if (!user || !dirty) return;
    void (async () => {
      const tags = list.map((url) => ['server', url] as [string, string]);
      const tag = clientTag();
      if (tag) tags.push(['client', tag]);
      const signed = await user.signer.signEvent({
        kind: 10063,
        content: '',
        tags,
        created_at: nowSec(),
      });
      setState('enqueued');
      request({
        grade: 'public',
        label: 'upload servers',
        identityPubkey: user.pubkey,
        relays: myWrite,
        events: [signed],
        preview: <ServersDiff old={declared} next={list} />,
      });
    })();
  };

  return (
    <div className="space-y-8">
      <Section
        title="upload servers"
        hint={
          pending
            ? 'syncing your list…'
            : declared.length > 0
              ? `${declared.length} in your kind 10063`
              : 'no kind 10063 yet — the default is used'
        }
      >
        <h3 className="text-muted-foreground text-xs font-medium">
          where your images upload — first entry is the primary (BUD-03)
        </h3>
        <ul>
          {list.map((url) => (
            <ServerRow
              key={url}
              url={url}
              source="yours"
              onRemove={() => setList((current) => current.filter((x) => x !== url))}
            />
          ))}
          {fromRelayList.map((url) => (
            <ServerRow key={url} url={url} source="nip-65" />
          ))}
          {declared.length === 0 && list.length === 0 && fromRelayList.length === 0 && (
            DEFAULT_BLOSSOM_SERVERS.map((url) => <ServerRow key={url} url={url} source="default" />)
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
