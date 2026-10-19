import { hostOf } from '@/lib/format';

export type RouteValue = 'tor' | 'direct';

/**
 * The one value chip: fg-tinted (`currentColor` mixes) so it renders
 * correctly on any surface — app background, or the black/white draft
 * swatch in the broadcast modal. Every relay/route/identity value in the
 * app renders through this; nothing hand-rolls a pill.
 */
export const Chip = ({
  children,
  dimmed = false,
}: {
  children: React.ReactNode;
  /** Rendered but muted — e.g. discovery relays before the toggle. */
  dimmed?: boolean;
}) => (
  <span
    className="rounded-sm px-1.5 py-0.5 font-mono text-[10px] leading-none"
    style={{
      backgroundColor: `color-mix(in srgb, currentColor ${dimmed ? '4%' : '8%'}, transparent)`,
      opacity: dimmed ? 0.4 : 0.75,
    }}
  >
    {children}
  </span>
);

/** A relay host chip — the one rendering of a relay anywhere. With
 *  `onToggle` it is a switch: tap to include/exclude the relay from the
 *  broadcast (the broadcast modal's per-relay row). */
export const RelayPill = ({ url, dimmed = false, onToggle, ariaLabel }: {
  url: string;
  dimmed?: boolean;
  onToggle?: () => void;
  ariaLabel?: string;
}) => onToggle
  ? (
    <button
      type="button"
      role="switch"
      aria-checked={!dimmed}
      aria-label={ariaLabel ?? `toggle ${hostOf(url)}`}
      onClick={onToggle}
      className="cursor-pointer"
    >
      <Chip dimmed={dimmed}>{hostOf(url)}</Chip>
    </button>
  )
  : <Chip dimmed={dimmed}>{hostOf(url)}</Chip>;

/** The transport route chip: `⏁ tor` / `clearnet`. */
export const RoutePill = ({ route }: { route: RouteValue }) => (
  <Chip>{route === 'tor' ? '⏁ tor' : 'clearnet'}</Chip>
);
