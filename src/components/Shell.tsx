import { Link, useLocation } from 'react-router-dom';

import { LoginArea } from '@/components/auth/LoginArea';
import { ConnectionStatus } from '@/components/ConnectionStatus';

/**
 * App template: menu on the left, content in the main area. Every surface
 * renders inside this shell.
 */
export const Shell = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();

  const navItem = (to: string, label: string) => (
    <Link
      to={to}
      className={`block rounded-lg px-4 py-3 text-lg transition-colors hover:bg-accent ${
        pathname === to ? 'font-bold' : 'font-normal text-muted-foreground'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r p-4">
          <Link to="/" className="mb-6 px-4 text-xl font-bold tracking-tight">nostr.black</Link>
          {navItem('/', 'Feed')}
          {navItem('/settings', 'Settings')}
          {navItem('/debug', 'Debug')}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b bg-background/95 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-xl items-center justify-between px-4">
              <Link to="/" className="font-semibold tracking-tight md:hidden">nostr.black</Link>
              <div className="ml-auto">
                <LoginArea className="max-w-60" />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-xl flex-1 overflow-y-auto p-4">{children}</main>
        </div>
      </div>

      <ConnectionStatus />
    </div>
  );
};
