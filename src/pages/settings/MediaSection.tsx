import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAppContext } from '@/hooks/useAppContext';
import { useMediaCache } from '@/hooks/useMediaCache';
import { Button } from '@/components/ui/button';
import { Section } from './Section';

export const MediaSection = () => {
  const { config, updateConfig } = useAppContext();
  const mediaCache = useMediaCache();
  const [maxMb, setMaxMbInput] = useState(String(config.mediaCacheMaxMb));
  const [maxDownloadMb, setMaxDownloadMbInput] = useState(String(config.mediaMaxDownloadMb));

  const saveCacheMax = async () => {
    const mb = Math.max(1, Math.floor(Number(maxMb) || 0));
    await mediaCache.setMaxMb(mb);
    updateConfig((current) => ({ ...current, mediaCacheMaxMb: mb }));
    setMaxMbInput(String(mb));
  };

  /** One media download over the cap is rejected with a visible error —
   * a server must never decide how much memory we allocate. */
  const saveMaxDownload = () => {
    const mb = Math.max(1, Math.floor(Number(maxDownloadMb) || 0));
    updateConfig((current) => ({ ...current, mediaMaxDownloadMb: mb }));
    setMaxDownloadMbInput(String(mb));
  };

  const clearCache = () => mediaCache.clear();

  return (
    <Section title="media" hint="fetched through the same route as relay traffic">
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-foreground"
          checked={config.imageCompression}
          onChange={(e) =>
            updateConfig((current) => ({ ...current, imageCompression: e.target.checked }))}
        />
        compress images on upload
      </label>

      <div className="flex items-center gap-2">
        <input
          className="w-20 rounded-sm border bg-transparent px-2 py-1 font-mono text-xs"
          value={maxDownloadMb}
          onChange={(e) => setMaxDownloadMbInput(e.target.value)}
          onBlur={saveMaxDownload}
          inputMode="numeric"
          aria-label="max media download MB"
        />
        <span className="text-muted-foreground text-xs">MB max per download — larger media is rejected</span>
      </div>

      {mediaCache.enabled && (
        <div className="space-y-1 pt-1">
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <Loader2 className={`size-3 ${mediaCache.bytes > 0 ? 'animate-spin' : 'hidden'}`} />
            cache {(mediaCache.bytes / 1024 / 1024).toFixed(1)} MB of{' '}
            {(mediaCache.maxBytes / 1024 / 1024).toFixed(0)} MB
          </p>
          <div className="flex items-center gap-2">
            <input
              className="w-20 rounded-sm border bg-transparent px-2 py-1 font-mono text-xs"
              value={maxMb}
              onChange={(e) => setMaxMbInput(e.target.value)}
              onBlur={saveCacheMax}
              inputMode="numeric"
              aria-label="media cache max MB"
            />
            <span className="text-muted-foreground text-xs">MB max — oldest media evicted first</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={clearCache}
            >
              clear cache
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
};
