import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bug, House, Menu, Settings, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { BrandMark } from '@/components/BrandMark';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const NAV: { to: string; label: string; Icon: LucideIcon }[] = [
  { to: '/', label: 'feed', Icon: House },
  { to: '/settings', label: 'settings', Icon: Settings },
  { to: '/debug', label: 'debug', Icon: Bug },
];

/**
 * App chrome. Desktop (md+): centred rail + feed. Mobile: header with
 * hamburger drawer (brand + account stay in the bar). Safe-area insets
 * for notched devices.
 */
export const Shell = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  const onFeed = pathname === '/';
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const navLink = (to: string, label: string, Icon: LucideIcon, onNavigate?: () => void) => {
    const active = pathname === to;
    return (
      <Link
        key={to}
        to={to}
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-3 rounded-sm px-2 py-2 text-[15px] font-semibold transition-colors',
          active
            ? 'text-foreground'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        <Icon className="size-5 shrink-0" strokeWidth={active ? 2.5 : 2} />
        {label}
      </Link>
    );
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Mobile header */}
      <header className="flex shrink-0 items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 md:hidden">
        <button
          type="button"
          aria-label={menuOpen ? 'close menu' : 'open menu'}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="text-foreground -ml-1 rounded-sm p-2"
        >
          {menuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
        <Link to="/" aria-label="home" className="text-2xl font-bold leading-none tracking-tight">
          <BrandMark />
        </Link>
        <div className="ml-auto">
          <LoginArea />
        </div>
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="menu">
          <button
            type="button"
            aria-label="close menu"
            className="absolute inset-0 bg-black/60"
            onClick={() => setMenuOpen(false)}
          />
          <nav
            className="bg-background absolute top-0 left-0 flex h-full w-[min(20rem,85vw)] flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <div className="mb-6 flex items-center justify-between gap-3">
              <Link
                to="/"
                aria-label="home"
                onClick={() => setMenuOpen(false)}
                className="text-2xl font-bold leading-none tracking-tight"
              >
                <BrandMark />
              </Link>
              <button
                type="button"
                aria-label="close menu"
                onClick={() => setMenuOpen(false)}
                className="rounded-sm p-2"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              {NAV.map(({ to, label, Icon }) =>
                navLink(to, label, Icon, () => setMenuOpen(false)),
              )}
              <Input
                type="search"
                placeholder="search"
                aria-label="search"
                disabled
                className="mt-3 h-8 w-full rounded-sm text-sm"
              />
            </div>
          </nav>
        </div>
      )}

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-[900px] flex-1">
        {/* Desktop rail */}
        <nav className="hidden h-full w-64 shrink-0 flex-col overflow-hidden px-3 pt-4 pb-3 md:flex">
          <Link
            to="/"
            aria-label="home"
            className="mb-5 block text-[36px] font-bold leading-none tracking-tight"
          >
            <BrandMark />
          </Link>

          <div className="flex flex-col gap-0.5">
            {NAV.map(({ to, label, Icon }) => navLink(to, label, Icon))}
            <Input
              type="search"
              placeholder="search"
              aria-label="search"
              disabled
              className="mt-3 h-8 w-full rounded-sm text-sm"
            />
          </div>

          <div className="mt-auto pt-4">
            <LoginArea className="w-full justify-start" />
          </div>
        </nav>

        <main
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pt-4 md:pb-3"
        >
          {onFeed && (
            <div
              aria-disabled="true"
              className="bg-card/50 text-muted-foreground min-h-[4.5rem] shrink-0 rounded-sm border border-border/50 px-3 py-2.5 text-sm"
            >
              write a note…
            </div>
          )}
          {children}
        </main>
      </div>

      <ConnectionStatus />
    </div>
  );
};
