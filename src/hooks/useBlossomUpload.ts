import { useCallback } from 'react';
import { blossomUpload, type UploadedBlob } from '@/net/blossom';
import { useBlossomServers } from '@/data/hooks/useBlossomServers';

export type { UploadedBlob };

/**
 * Upload bytes to the user's first blossom server (their kind 10006
 * list, `server` tags on their relay list, or the app default — see
 * useBlossomServers). A hook rather than a bare import: src/net is the
 * egress boundary, surfaces reach it through this layer.
 *
 * `signWith` is the key that signs the kind-24242 auth event — pass the
 * same identity that will sign what references the blob.
 */
export const useBlossomUpload = (): ((
  bytes: Uint8Array,
  type: string,
  signWith: Uint8Array,
  /** Overrides the resolved server — deferred broadcasts state theirs
   *  in the modal's upload line and must send exactly there. */
  server?: string,
) => Promise<UploadedBlob>) => {
  const { servers } = useBlossomServers();
  return useCallback(
    (bytes: Uint8Array, type: string, signWith: Uint8Array, server?: string) =>
      blossomUpload(bytes, type, server ?? servers[0]!, signWith),
    [servers],
  );
};
