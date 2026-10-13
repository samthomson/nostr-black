import { getSecretKey } from '@/auth/keystore';
import { useKeystore } from '@/auth/useKeystore';

/** Session nsec, or null when locked / signed in through an extension. */
export const useSessionKey = (): Uint8Array | null => {
  const { unlocked } = useKeystore();
  return unlocked ? getSecretKey() : null;
};
