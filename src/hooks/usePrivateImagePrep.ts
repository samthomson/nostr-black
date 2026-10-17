import { useCallback } from 'react';
import { useAppContext } from '@/hooks/useAppContext';
import { compressImage } from '@/lib/imageCompress';
import { encryptImage, type EncryptedImage } from '@/lib/fileMessage';

/** One staged private image: its media-tag descriptors plus the
 * ciphertext, held locally until the broadcast confirms. */
export interface StagedImage extends EncryptedImage {
  mime: string;
}

/**
 * Stage private-note images: compress (per setting), then AES-GCM
 * encrypt under the conversation's reply CEK. No bytes leave the
 * device — the ciphertext uploads inside the confirmed broadcast, the
 * descriptors ride the kind-1 rumor's media tags. Failures throw to
 * the caller — nothing is dropped silently.
 */
export const usePrivateImagePrep = (): ((
  replyCek: Uint8Array,
  files: File[],
) => Promise<StagedImage[]>) => {
  const { config } = useAppContext();
  return useCallback(async (replyCek: Uint8Array, files: File[]): Promise<StagedImage[]> => {
    const staged: StagedImage[] = [];
    for (const file of files) {
      const compressed = config.imageCompression
        ? await compressImage(file)
        : {
            bytes: new Uint8Array(await file.arrayBuffer()),
            type: file.type || 'application/octet-stream',
            width: 0,
            height: 0,
          };
      staged.push({ ...encryptImage(replyCek, compressed.bytes), mime: compressed.type });
    }
    return staged;
  }, [config.imageCompression]);
};
