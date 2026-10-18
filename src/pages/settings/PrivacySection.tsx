import { useAppContext } from '@/hooks/useAppContext';
import { ClientTagSection } from './ClientTagSection';
import { Section } from './Section';

/** Privacy-facing media settings: what renders without asking, and what
 * leaves the device trimmed. */
export const PrivacySection = () => {
  const { config, updateConfig } = useAppContext();
  return (
    <div className="space-y-3">
      <Section title="privacy" hint="what loads, and what leaves, without asking">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            checked={config.mediaEnabled}
            onChange={(e) =>
              updateConfig((current) => ({ ...current, mediaEnabled: e.target.checked }))}
          />
          show images and video
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-foreground"
            checked={false}
            disabled
          />
          strip image metadata on upload
          <span className="text-muted-foreground text-xs">(todo)</span>
        </label>
      </Section>
      <ClientTagSection />
    </div>
  );
};
