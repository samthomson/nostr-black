import { Link, useLocation } from 'react-router-dom';
import { Bug, House, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { BrandMark } from '@/components/BrandMark';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Centred app column (Jumble/Primal): rail + feed as one unit, max ~860px,
 * floating in the viewport. Nav is icon+label rows; search lives in the rail.
 */
export const Shell = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  const onFeed = pathname === '/';

  const navItem = (to: string, label: string, Icon: LucideIcon) => {
    const active = pathname === to;
    return (
      <Link
        to={to}
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
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-[900px] flex-1">
        <nav className="flex h-full w-64 shrink-0 flex-col overflow-hidden px-3 pt-4 pb-3">
          <Link
            to="/"
            aria-label="home"
            className="mb-5 block text-[36px] font-bold leading-none tracking-tight"
          >
            <BrandMark />
          </Link>

          <div className="flex flex-col gap-0.5">
            {navItem('/', 'feed', House)}
            {navItem('/settings', 'settings', Settings)}
            {navItem('/debug', 'debug', Bug)}
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

        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-4 pb-3">
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
