import type { ReactNode } from 'react';
import { Shell } from '@/components/Shell';

/**
 * App page template: Shell + optional title chrome + body.
 * Omit `title` for untitled surfaces (feed, profile, note).
 * `title` is ReactNode — string or richer JSX (tags, etc.).
 */
export const Page = ({
  title,
  nav,
  actions,
  children,
}: {
  title?: ReactNode;
  nav?: ReactNode;
  /** Right-aligned controls in the title row (e.g. feed-kind toggles). */
  actions?: ReactNode;
  children: ReactNode;
}) => (
  <Shell>
    {title ? (
      <div className="mb-3 space-y-2">
        {/* A fixed-height band: the title sets the rhythm, actions ride
            the same band instead of floating beside it. */}
        <div className="flex min-h-8 items-center gap-2">
          <h1 className="flex items-center gap-2 text-lg font-semibold">{title}</h1>
          {actions && (
            <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>
          )}
        </div>
        {nav}
      </div>
    ) : null}
    {children}
  </Shell>
);
