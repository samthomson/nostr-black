import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bug, ChevronDown, ChevronLeft, ChevronRight, House, Lock, Menu, Settings, User, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { BrandMark } from '@/components/BrandMark';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { profileHref } from '@/lib/format';
import { PrivacyTag, type PrivacyTagGrade } from '@/components/PrivacyTag';
import { useAnchorSpacer, useSpacerRefs } from '@/components/columns/useAnchorSpacer';
import { useColumns, type ColumnPointer } from '@/components/columns/columnsState';
import { ColumnsProvider } from '@/components/columns/ColumnsContext';
import { NoteColumn } from '@/components/columns/NoteColumn';
import { cn } from '@/lib/utils';
type NavItem = {
  to: string;
  label: string;
  Icon: LucideIcon;
  grade?: PrivacyTagGrade;
  /** Contained sub-pages, indented below and shown when the section is
   *  open or when one of them is the active page. */
  children?: NavItem[];
};
type Grade = NavItem['grade'];

/**
 * A nav entry with contained sub-pages: a caret toggles them open, they
 * indent one level, and the section starts open whenever one of the
 * children is the active page (or when the parent itself is).
 */
const NavGroup = ({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) => {
  const containsActive = (i: NavItem): boolean =>
    pathname === i.to || pathname.startsWith(`${i.to}/`) || (i.children?.some(containsActive) ?? false);
  const [open, setOpen] = useState(containsActive(item));
  // Following the active page beats the stored toggle: landing on a
  // contained page reveals its section even if the user had it closed.
  if (containsActive(item) && !open) setOpen(true);

  const row = (to: string, label: string, Icon: LucideIcon, grade?: PrivacyTagGrade, indent = false) => {
    const active = pathname === to || pathname.startsWith(`${to}/`);
    return (
      <Link
        key={to}
        to={to}
        onClick={onNavigate}
        className={cn(
          'hover:bg-accent/50 flex items-center gap-3 rounded-sm py-2 text-sm',
          indent ? 'pl-6 pr-2.5' : 'px-2.5',
          active ? 'text-foreground bg-accent' : 'text-muted-foreground',
        )}
      >
        <Icon className={active ? 'size-5' : 'size-5'} strokeWidth={active ? 2.5 : 2} />
        {grade ? <PrivacyTag grade={grade}>{label}</PrivacyTag> : label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'hover:bg-accent/50 flex w-full items-center gap-3 rounded-sm px-2.5 py-2 text-sm',
          containsActive(item) ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <item.Icon className="size-5" strokeWidth={containsActive(item) ? 2.5 : 2} />
        {item.grade ? <PrivacyTag grade={item.grade}>{item.label}</PrivacyTag> : item.label}
        {open
          ? <ChevronDown className="text-muted-foreground ml-auto size-4" />
          : <ChevronRight className="text-muted-foreground ml-auto size-4" />}
      </button>
      {open && item.children?.map((child) => row(child.to, child.label, child.Icon, child.grade, true))}
    </div>
  );
};

/**
 * App chrome. Desktop (md+): centred rail + main column + any opened note
 * panes to its right. Mobile: header with hamburger drawer (brand + account
 * stay in the bar). Safe-area insets for notched devices.
 */
export const Shell = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  const { user } = useCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  if (pathname !== menuPath) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  const profileTo = user ? profileHref(user.pubkey) : undefined;
  // Privacy is colour: the public feed and profile are white, the private
  // feed and encrypted connections black.
  const nav: NavItem[] = [
    { to: '/public-feed', label: 'feed', Icon: House, grade: 'public' },
    { to: '/private-feed', label: 'private feed', Icon: Lock, grade: 'private' },
    { to: '/connections', label: 'connections', Icon: Users, grade: 'private' },
    ...(profileTo ? [{ to: profileTo, label: 'profile', Icon: User, grade: 'public' as const }] : []),
    {
      to: '/follows',
      label: 'follows',
      Icon: Users,
      grade: ['public', 'low'],
      children: [
        { to: '/follows', label: 'follows', Icon: Users, grade: ['public', 'low'] },
        { to: '/mutes', label: 'mutes', Icon: Users, grade: ['public', 'low'] },
      ],
    },
    { to: '/settings', label: 'settings', Icon: Settings },
    { to: '/debug', label: 'debug', Icon: Bug },
  ];

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  // A parent whose section contains the active page starts open; the
  // caret toggles it manually. Children indent one level.
  const navLink = (to: string, label: string, Icon: LucideIcon, grade: Grade, onNavigate?: () => void) => {
    const active = pathname === to || pathname.startsWith(`${to}/`);
    return (
      <Link
        key={to}
        to={to}
        onClick={onNavigate}
        className={cn(
          'hover:bg-accent/50 flex items-center gap-3 rounded-sm px-2.5 py-2 text-sm',
          active ? 'text-foreground bg-accent' : 'text-muted-foreground',
        )}
      >
        <Icon className={active ? 'size-5' : 'size-5'} strokeWidth={active ? 2.5 : 2} />
        {grade ? <PrivacyTag grade={grade}>{label}</PrivacyTag> : label}
      </Link>
    );
  };

  const navBlock = (onNavigate?: () => void) => (
    <div className="flex flex-col gap-0.5">
      {nav.map((item) => (
        item.children
          ? <NavGroup key={item.to} item={item} pathname={pathname} onNavigate={onNavigate} />
          : navLink(item.to, item.label, item.Icon, item.grade, onNavigate)
      ))}
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
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
          <nav className="bg-background absolute top-0 left-0 flex h-full w-[min(20rem,85vw)] flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
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
            {navBlock(() => setMenuOpen(false))}
          </nav>
        </div>
      )}

      <ColumnsProvider>
        <ColumnsContent navBlock={navBlock}>{children}</ColumnsContent>
      </ColumnsProvider>

      <ConnectionStatus />
    </div>
  );
};

/** The feed column's own max width — each open pane grows the row by one
 *  more of these, so every column (feed included) keeps feed width. */
const SHARE_PX = 900;

/**
 * The widening content row. With panes open, main and the panes are
 * equal flex shares: the row's own max-width transition is the single
 * driver of the resize (no per-pane width animation to fight it), every
 * style value stays an explicit length so nothing snaps, and the feed's
 * left edge never moves. The feed freezes (scroll and content) while
 * panes are open — it is backdrop. On narrow viewports only the last
 * pane shows, full-width, behind a sliver strip that taps back one
 * depth.
 */
const ColumnsContent = ({
  navBlock,
  children,
}: {
  navBlock: (onNavigate?: () => void) => React.ReactNode;
  children: React.ReactNode;
}) => {
  const stack = useColumns();
  const columns = stack?.columns ?? [];
  const open = stack?.open;
  const close = stack?.close;
  const closeAll = stack?.closeAll;
  const narrow = stack?.narrow ?? false;
  const count = columns.length;
  const active = count > 0;
  // The anchored card pins at PIN_OFFSET; the spacer makes that reachable
  // and keeps it pinned through churn. The mechanism lives in the hook.
  const [mainRef, spacerRef] = useSpacerRefs();
  const anchorId = columns[0]?.id;
  const spacer = useAnchorSpacer(mainRef, spacerRef, active, anchorId);
  // Panes leaving the stack collapse out (below) — track them one beat.
  // Render-phase state adjust (the useFeed routing-key pattern): no refs.
  const [prevColumns, setPrevColumns] = useState(columns);
  const [exiting, setExiting] = useState<readonly ColumnPointer[]>([]);
  if (prevColumns !== columns) {
    const removed = prevColumns.filter((c) => !columns.some((n) => n.id === c.id));
    setPrevColumns(columns);
    if (removed.length > 0) {
      setExiting(removed);
      setTimeout(() => {
        setExiting((current) => current.filter((c) => !removed.some((r) => r.id === c.id)));
      }, 320);
    }
  }
  return (
    <div
      className="relative z-10 flex min-h-0 flex-1 transition-[max-width,margin-right,width] duration-300 ease-out"
      style={{
        // Each open column grows the row by one feed width; inside, main
        // and the panes are all flex-1 basis-0 — EQUAL shares, and the
        // row's own max-width transition is what narrows the feed.
        maxWidth: narrow ? undefined : `${SHARE_PX * (count + 1)}px`,
        // Every value is an explicit length — `auto` never appears, so
        // max-width, margins AND width all interpolate. The centering
        // margin M = max(0, 50% - 450px): closed, M both sides (centered
        // 900px); open, all slack to the right (left edge pinned).
        marginLeft: 'max(0px, calc(50% - 450px))',
        marginRight: active && !narrow ? '0px' : 'max(0px, calc(50% - 450px))',
        width: active && !narrow
          ? 'calc(100% - max(0px, calc(50% - 450px)))'
          : 'calc(100% - 2 * max(0px, calc(50% - 450px)))',
      }}
    >
      {/* Desktop rail */}
      <nav className="hidden h-full w-64 shrink-0 flex-col overflow-hidden px-3 pt-4 pb-3 md:flex">
        <Link
          to="/"
          aria-label="home"
          className="mb-5 block text-[36px] font-bold leading-none tracking-tight"
        >
          <BrandMark />
        </Link>
        {navBlock()}
        <div className="mt-auto pt-4">
          <LoginArea className="w-full justify-start" />
        </div>
      </nav>
      {/* Narrow: everything left of the active pane is one back strip. */}
      {narrow && active && (
        <button
          type="button"
          aria-label="back"
          onClick={() => close?.(count - 1)}
          className="border-border/60 text-muted-foreground flex h-full w-7 shrink-0 flex-col items-center justify-start border-r pt-3 md:hidden"
        >
          <ChevronLeft className="size-4" />
        </button>
      )}
      <main
        ref={mainRef}
        className={cn(
          // flex-1: an equal share beside the panes. The scrollbar gutter
          // is reserved ALWAYS — a classic scrollbar appearing/disappearing
          // would change the width by its track and re-wrap every note
          // mid-animation.
          'flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pt-4 md:pb-3',
          // Panes open: the feed is backdrop — inert. overflow-y-hidden
          // freezes it (scrollTop keeps; restoring the class unfreezes).
          active && 'columns-dim cursor-pointer overflow-y-hidden',
          narrow && active && 'hidden md:flex',
        )}
        style={{ scrollbarGutter: 'stable' }}
        onClick={active ? closeAll : undefined}
      >
        {/* One content child: the FLIP scroll (Note) translates this
            wrapper while the scroller itself is frozen. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {children}
          {/* Deficit spacer: lets the last anchored card pin to the top. */}
          <div ref={spacerRef} aria-hidden="true" className="shrink-0" style={{ height: spacer }} />
        </div>
      </main>

      {/* Panes removed from the stack render one more beat, collapsing
          to zero width — without this the close is an instant vanish. */}
      {exiting.map((pointer) => (
        <section
          key={pointer.id}
          aria-hidden="true"
          className="border-border/60 bg-background/40 animate-pane-out flex min-h-0 flex-1 basis-0 flex-col overflow-hidden border-l"
        />
      ))}
      {columns.map((pointer, i) => {
        const last = i === count - 1;
        return (
          <section
            key={pointer.id}
            aria-label="note column"
            className={cn(
              'border-border/60 bg-background/40 animate-pane-in flex min-h-0 min-w-0 flex-1 basis-0 flex-col overflow-hidden border-l',
              narrow ? (last ? '' : 'hidden') : '',
              !last && 'columns-dim',
            )}
            // A dimmed pane is still live: its replies iterate (opening at
            // their depth), its reactions open — and clicking its empty
            // ground closes everything to the right of it.
            onClick={last ? undefined : (e) => {
              if ((e.target as HTMLElement).closest('[data-slot="card"], button, a, textarea, [role="dialog"]')) return;
              close?.(i + 1);
            }}
          >
            <NoteColumn
              pointer={pointer}
              depth={i}
              anchorId={columns[i + 1]?.id}
              dimmed={!last}
              onOpen={(next, depth) => open?.(next, depth)}
              onClose={() => close?.(i)}
            />
          </section>
        );
      })}
    </div>
  );
};
