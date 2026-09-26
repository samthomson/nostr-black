
import { Link, useLocation } from 'react-router-dom';
import { Bug, Newspaper, Settings } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';

/**
 * App template: menu on the left, content in the main area. Every surface
 * renders inside this shell.
 */
export const Shell = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();

  const navItem = (to: string, icon: React.ReactNode, label: string) => (
    <Link
      to={to}
      className={`flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium hover:bg-accent ${pathname === to ? 'bg-accent' : ''}`}
    >
      {icon}
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r p-4 md:flex">
        <Link to="/" className="mb-4 px-2 font-semibold tracking-tight">nostr.black</Link>
        {navItem('/', <Newspaper className="size-4" />, 'your feed')}
        {navItem('/settings', <Settings className="size-4" />, 'settings')}
        {navItem('/debug', <Bug className="size-4" />, 'debug')}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
            <Link to="/" className="font-semibold tracking-tight md:hidden">nostr.black</Link>
            <div className="ml-auto">
              <LoginArea className="max-w-60" />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-xl p-4">{children}</main>
      </div>
    </div>
  );
};
