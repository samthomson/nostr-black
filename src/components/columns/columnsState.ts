import { createContext, useContext } from 'react';

/** What a column needs to fetch and render one note. */
export interface ColumnPointer {
  id: string;
  author?: string;
  /** Relay hints from the click that opened it (foundOn / nevent). */
  relays?: string[];
  /** True for sealed notes: the pane reads conversation data, never relays. */
  private?: boolean;
}

export interface Columns {
  /** Open panes, left to right. Pane i's parent is pane i-1 (or the feed). */
  columns: readonly ColumnPointer[];
  /**
   * Open a note. `depth` is the column the click happened in — everything
   * right of it belongs to that click's chain and is replaced. No depth:
   * opened from the main column, so the whole stack is replaced.
   */
  open: (pointer: ColumnPointer, depth?: number) => void;
  /** Close one pane and every pane it spawned to its right. */
  close: (index: number) => void;
  closeAll: () => void;
  /** False on narrow viewports — callers fall back to navigating. */
  enabled: boolean;
  /** True on narrow viewports: one pane at a time, sliver back-strip. */
  narrow: boolean;
}

/** The column stack. Undefined outside a `ColumnsProvider` — callers keep
 *  their plain navigating behaviour. */
export const ColumnsContext = createContext<Columns | undefined>(undefined);

export const useColumns = (): Columns | undefined => useContext(ColumnsContext);
