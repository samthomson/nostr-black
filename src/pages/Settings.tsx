import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Page } from '@/components/Page';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { cn } from '@/lib/utils';
import { NetworkSection } from './settings/NetworkSection';
import { MediaSection } from './settings/MediaSection';
import { ReactionSection } from './settings/ReactionSection';
import { AccountSection } from './settings/AccountSection';
import { CacheSection } from './settings/CacheSection';

const SETTINGS_SECTIONS = [
  { id: 'network', label: 'network' },
  { id: 'media', label: 'media' },
  { id: 'reaction', label: 'reaction' },
  { id: 'account', label: 'account' },
  { id: 'cache', label: 'cache' },
] as const;

type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]['id'];

const DEFAULT_SECTION: SettingsSectionId = 'network';

const isSectionId = (value: string): value is SettingsSectionId =>
  SETTINGS_SECTIONS.some((s) => s.id === value);

const PANELS: Record<SettingsSectionId, React.FC> = {
  network: NetworkSection,
  media: MediaSection,
  reaction: ReactionSection,
  account: AccountSection,
  cache: CacheSection,
};

const SectionTabs = () => {
  const { pathname } = useLocation();
  const active = pathname.match(/^\/settings\/([^/]+)/)?.[1];

  return (
    <nav aria-label="settings sections" className="flex flex-wrap gap-1">
      {SETTINGS_SECTIONS.map(({ id, label }) => {
        const isActive = active === id;
        return (
          <Link
            key={id}
            to={`/settings/${id}`}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'rounded-sm border px-2.5 py-1 text-sm font-medium transition-colors',
              isActive
                ? 'border-border text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
};

const SettingsSectionPage = () => {
  const { section } = useParams<{ section: string }>();
  if (!section || !isSectionId(section)) {
    return <Navigate to={`/settings/${DEFAULT_SECTION}`} replace />;
  }
  const Panel = PANELS[section];
  return <Panel />;
};

const SettingsRoutes = () => (
  <Routes>
    <Route index element={<Navigate to={`/settings/${DEFAULT_SECTION}`} replace />} />
    <Route path=":section" element={<SettingsSectionPage />} />
  </Routes>
);

const SettingsPage = () => {
  useSeoMeta({ title: 'settings — nostr.black' });
  const { user } = useCurrentUser();

  // Logged-out settings (discovery relays, pre-login) render inside the
  // landing page, not the app shell — the shell's other tabs need a session.
  if (!user) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <SettingsRoutes />
      </div>
    );
  }

  return (
    <Page title="settings" nav={<SectionTabs />}>
      <SettingsRoutes />
    </Page>
  );
};

export default SettingsPage;
