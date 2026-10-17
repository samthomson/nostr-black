import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { ColumnsContext, type ColumnPointer } from './columnsState';

const useViewport = (): { desktop: boolean; narrow: boolean } => {
  const query = typeof window !== 'undefined' ? window.matchMedia('(min-width: 768px)') : undefined;
  const [desktop, setDesktop] = useState(() => query?.matches ?? true);
  useEffect(() => {
    if (!query) return;
    const onChange = () => setDesktop(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return { desktop, narrow: !desktop };
};

/**
 * The column system: opening a note never navigates — it stacks a pane to
 * the right of the main column, whose own scroll container never moves, so
 * closing the pane lands exactly where the reader was. Depth is the user's
 * clicks: a reply inside pane i opens pane i+1, replacing i's old children.
 *
 * Desktop: panes sit beside an unchanging main column. Narrow viewports:
 * one pane at a time — everything left of it collapses into a sliver whose
 * tap goes back one depth, so the back gesture exists at every width.
 *
 * The provider lives inside `Shell`, so navigating between pages unmounts
 * it — the stack dies with the page it belonged to.
 */
export const ColumnsProvider = ({ children }: { children: ReactNode }) => {
  const [columns, setColumns] = useState<readonly ColumnPointer[]>([]);
  const { desktop, narrow } = useViewport();
  const location = useLocation();

  // The page behind the columns changed — the stack belonged to the old
  // one. Render-phase adjust, same pattern as useFeed's routing key.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname);
    setColumns([]);
  }

  const open = useCallback((pointer: ColumnPointer, depth?: number) => {
    setColumns((current) => {
      const chain = depth === undefined ? [] : current.slice(0, depth + 1);
      // Opening the note a pane already shows collapses to it — the
      // reader walked back up their own chain.
      const existing = chain.findIndex((c) => c.id === pointer.id);
      if (existing >= 0) return chain.slice(0, existing + 1);
      return [...chain, pointer];
    });
  }, []);

  const close = useCallback((index: number) => {
    setColumns((current) => current.slice(0, index));
  }, []);

  const closeAll = useCallback(() => setColumns([]), []);

  // Escape unwinds one pane — the keyboard reader's back arrow. An open
  // dialog owns Escape first (the broadcast modal closes, the pane stays).
  useEffect(() => {
    if (columns.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"]')) return;
      setColumns((current) => current.slice(0, -1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [columns.length]);

  const value = useMemo(
    () => ({ columns, open, close, closeAll, enabled: desktop, narrow }),
    [columns, open, close, closeAll, desktop, narrow],
  );

  return <ColumnsContext.Provider value={value}>{children}</ColumnsContext.Provider>;
};
