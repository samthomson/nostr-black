import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

/**
 * React Query devtools — dev builds only. Button bottom-right, above the
 * ConnectionStatus bar, so it stays clear of the centred app column.
 */
export const QueryDevtools = () =>
  import.meta.env.DEV ? (
    <div className="fixed right-3 bottom-10 z-[100000]">
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="relative" />
    </div>
  ) : null;
