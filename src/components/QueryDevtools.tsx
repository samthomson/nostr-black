import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

/**
 * React Query devtools — dev builds only (import.meta.env.DEV is statically
 * replaced, so this renders nothing and the package is tree-shaken out of
 * production builds). Keeps App.tsx a pure provider stack.
 */
export const QueryDevtools = () =>
  import.meta.env.DEV ? (
    <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
  ) : null;
