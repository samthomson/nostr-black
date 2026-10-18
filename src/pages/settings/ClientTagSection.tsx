import { useAppContext } from '@/hooks/useAppContext';
import { COMMON_CLIENTS } from '@/lib/clientTag';
import { ChipInput } from '@/components/ui/chip-input';
import { Button } from '@/components/ui/button';
import { Section } from './Section';

const MODES = [
  { value: 'none', label: 'no client tag', hint: 'none published (default)' },
  { value: 'black', label: 'nostr.black', hint: 'sign events as nostr.black' },
  { value: 'spoof', label: 'spoof to…', hint: 'sign events as one of the clients below, picked per event' },
] as const;

/** One radio row of the client-tag choice. */
const ModeOption = ({
  label,
  hint,
  checked,
  onPick,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onPick: () => void;
}) => (
  <label className="flex cursor-pointer items-center gap-2 text-sm">
    <input
      type="radio"
      name="client-tag-mode"
      className="size-4 accent-foreground"
      checked={checked}
      onChange={onPick}
    />
    <span>{label}</span>
    <span className="text-muted-foreground text-xs">{hint}</span>
  </label>
);

/** The client tag stamped on everything this app broadcasts — published
 * metadata, so it is always a deliberate choice. */
export const ClientTagSection = () => {
  const { config, updateConfig } = useAppContext();
  const policy = config.clientTag;
  const setMode = (mode: 'none' | 'black' | 'spoof') =>
    updateConfig((current) => ({
      ...current,
      clientTag: { mode, spoof: current.clientTag?.spoof ?? [] },
    }));
  const addSpoof = (rawName: string) => {
    const name = rawName.trim();
    if (!name || policy.spoof.includes(name)) return;
    updateConfig((current) => ({
      ...current,
      clientTag: { mode: 'spoof', spoof: [...(current.clientTag?.spoof ?? []), name] },
    }));
  };

  const suggestions = COMMON_CLIENTS.filter((c) => !policy.spoof.includes(c));

  return (
    <Section title="client tag" hint="what this app claims to be on published events">
      <div className="space-y-2">
        {MODES.map((mode) => (
          <ModeOption
            key={mode.value}
            label={mode.label}
            hint={mode.hint}
            checked={policy.mode === mode.value}
            onPick={() => setMode(mode.value)}
          />
        ))}
      </div>

      {policy.mode === 'spoof' && (
        <div className="space-y-2 pt-1">
          <ChipInput
            values={policy.spoof}
            onChange={(spoof) => updateConfig((current) => ({
              ...current,
              clientTag: { mode: 'spoof', spoof },
            }))}
            placeholder="client name"
            ariaLabel="spoof client name"
          />
          {suggestions.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-muted-foreground text-xs">common:</span>
              {suggestions.map((name) => (
                <Button
                  key={name}
                  variant="ghost"
                  size="xs"
                  onClick={() => addSpoof(name)}
                >
                  + {name}
                </Button>
              ))}
            </div>
          )}
          {policy.spoof.length === 0 && (
            <p className="text-muted-foreground text-xs">
              add at least one name — with an empty pool no tag is sent
            </p>
          )}
        </div>
      )}
    </Section>
  );
};
