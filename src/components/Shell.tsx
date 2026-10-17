import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { anchorSpacerHeight } from '@/lib/anchorSpacer';
import { Link, useLocation } from 'react-router-dom';
import { Bug, ChevronLeft, House, Lock, Menu, Settings, User, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { BrandMark } from '@/components/BrandMark';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { profileHref } from '@/lib/format';
import { PrivacyTag } from '@/components/PrivacyTag';
import { cn } from '@/lib/utils';
import { ColumnsProvider } from '@/components/columns/ColumnsContext';
import { useColumns, type ColumnPointer } from '@/components/columns/columnsState';
import { NoteColumn } from '@/components/columns/NoteColumn';

type NavItem = { to: string; label: string; Icon: LucideIcon; grade?: import('@/lib/privacy').PrivacyGrade };
type Grade = NavItem['grade'];

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
  // Privacy is colour: the public feed is white, the private feed black,
  // encrypted connections near-black; your profile is a public page.
  const nav: NavItem[] = [
    { to: '/public-feed', label: 'feed', Icon: House, grade: 'public' },
    { to: '/private-feed', label: 'private feed', Icon: Lock, grade: 'private' },
    { to: '/connections', label: 'connections', Icon: Users, grade: 'high' },
    ...(profileTo ? [{ to: profileTo, label: 'profile', Icon: User }] : []),
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
      {nav.map(({ to, label, Icon, grade }) => navLink(to, label, Icon, grade, onNavigate))}
      <Input
        type="search"
        placeholder="search"
        className="bg-accent/40 mt-2 rounded-sm text-sm"
        aria-label="search"
      />
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

/** One column's share (feed and panes are equal-width when open). */
const SHARE_REM = 41;


/**
 * The widening content row. The main column's width never changes when
 * panes open — it has no reason to reflow, so its scroll position and
 * the reader's place are untouched by construction. Panes take fixed
 * slots in the space the container grows by. On narrow viewports only
 * the last pane shows, full-width, behind a sliver strip that taps back
 * one depth.
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

  // The anchored card pins to the top of the feed column. When it is the
  // LAST item there is nothing below it, so the browser would clamp the
  // scroll short — a spacer of exactly the deficit makes the pin
  // reachable. Measured ONCE per anchor (a layout effect keyed on the
  // anchor, not on the spacer): natural height comes from the live DOM
  // (scrollHeight minus the spacer element's own height), never from
  // state, so the measurement can't feed back into itself. The reset on
  // close is render-phase (the exiting-panes pattern); the browser then
  // clamps scrollTop back to the natural position by itself.
  const mainRef = useRef<HTMLElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const [spacer, setSpacer] = useState(0);
  const anchorId = columns[0]?.id;
  if (!active && spacer !== 0) setSpacer(0);
  useLayoutEffect(() => {
    if (!active || !anchorId) return;
    const measure = (): void => {
      const scroller = mainRef.current;
      const spacerEl = spacerRef.current;
      const card = scroller?.querySelector('[data-anchor]') ?? null;
      if (!scroller || !spacerEl) return;
      // Live churn can evict the anchored note from the feed entirely —
      // then there is nothing to pin and the spacer must not linger.
      if (!card) {
        spacerEl.style.height = '0px';
        setSpacer((cur) => (cur === 0 ? cur : 0));
        return;
      }
      const scrollerTop = scroller.getBoundingClientRect().top;
      const top = card.getBoundingClientRect().top - scrollerTop + scroller.scrollTop;
      const natural = scroller.scrollHeight - spacerEl.offsetHeight;
      const next = anchorSpacerHeight(top, natural, scroller.clientHeight, 56);
      // Write the height to the DOM first — a state-only update lands a
      // render later, and the re-pin below must see the restored max
      // NOW. React later writes the same value from state; no conflict.
      spacerEl.style.height = `${next}px`;
      setSpacer((cur) => (cur === next ? cur : next));
      // Re-pin: churn clamps the scroll off the target; with the spacer
      // restored the target is reachable again. Never mid-FLIP — the
      // scroller is frozen then and the card rect is mid-transform.
      const offset = card.getBoundingClientRect().top - scrollerTop;
      if (scroller.style.overflow !== 'hidden' && Math.abs(offset - 56) > 2) {
        scroller.scrollTop += offset - 56;
      }
    };
    // and a shrunk max re-clamps the scroll off the pin. Re-derive the
    // deficit whenever the content box resizes; it reads the spacer from
    // the DOM, never state, so the loop converges instead of feeding back.
    const content = mainRef.current?.firstElementChild;
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(content ?? document.body);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [active, anchorId]);
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
        // Each open column grows the row by one share; inside, main and
        // the panes are all flex-1 basis-0 — EQUAL widths, and the row's
        // own max-width transition is what narrows the feed, smoothly.
        maxWidth: narrow ? undefined : `calc(900px + ${count * SHARE_REM}rem)`,
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
          // flex-1: the feed smoothly yields as pane widths animate in
          // and out. The scrollbar gutter is reserved ALWAYS — a classic
          // scrollbar appearing/disappearing would change its width by
          // its track and re-wrap every note mid-animation.
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
              onOpen={(next, depth) => open?.(next, depth)}
              onClose={() => close?.(i)}
            />
          </section>
        );
      })}
    </div>
  );
};
