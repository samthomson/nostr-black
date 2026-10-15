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
  children,
}: {
  title?: ReactNode;
  nav?: ReactNode;
  children: ReactNode;
}) => (
  <Shell>
    {title ? (
      <div className="mb-3 space-y-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold">{title}</h1>
        {nav}
      </div>
    ) : null}
    {children}
  </Shell>
);
