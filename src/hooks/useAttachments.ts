import { useCallback, useEffect, useRef, useState } from 'react';
import { isUploadableImage } from '@/lib/imageCompress';

export interface Attachment {
  id: string;
  file: File;
  previewUrl: string;
}

/** Upload cap per note — the media grid tiles pairs, and note weight
 * matters more than album completeness. */
export const MAX_ATTACHMENTS = 4;

let nextId = 0;

/**
 * Staged image attachments for a composer: add from a file picker or a
 * clipboard paste, preview locally, remove again. Purely local — the
 * caller owns upload (it knows the grade and the keys). Image files
 * only: anything else a user might drop is rejected at the door.
 */
export const useAttachments = () => {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const previews = useRef<Set<string>>(new Set());

  // Everything staged when the composer unmounts is abandoned — its
  // object URL goes with it.
  useEffect(() => () => {
    for (const url of previews.current) URL.revokeObjectURL(url);
  }, []);

  const addFiles = useCallback((files: File[]) => {
    // Uploadable types only: the preview must render everywhere and the
    // pipeline must understand the bytes — same rule as the profile
    // pictures.
    const images = files.filter(isUploadableImage);
    if (images.length === 0) return;
    setAttachments((current) => {
      const room = MAX_ATTACHMENTS - current.length;
      if (room <= 0) return current;
      const added = images.slice(0, room).map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previews.current.add(previewUrl);
        return { id: `att-${nextId++}`, file, previewUrl } satisfies Attachment;
      });
      return [...current, ...added];
    });
  }, []);

  /** A paste event carrying image files — call from the textarea's
   *  onPaste; the default paste of the *files* is prevented, text pastes
   *  untouched. */
  const addFromPaste = useCallback((e: React.ClipboardEvent) => {
    const images = Array.from(e.clipboardData?.files ?? []).filter(isUploadableImage);
    if (images.length === 0) return;
    e.preventDefault();
    addFiles(images);
  }, [addFiles]);
  const remove = useCallback((id: string) => {
    setAttachments((current) => {
      const gone = current.find((a) => a.id === id);
      if (gone) {
        URL.revokeObjectURL(gone.previewUrl);
        previews.current.delete(gone.previewUrl);
      }
      return current.filter((a) => a.id !== id);
    });
  }, []);

  /** Drop everything, revoking previews — call after a successful send. */
  const clear = useCallback(() => {
    setAttachments((current) => {
      for (const a of current) {
        URL.revokeObjectURL(a.previewUrl);
        previews.current.delete(a.previewUrl);
      }
      return [];
    });
  }, []);

  return { attachments, addFiles, addFromPaste, remove, clear };
};
