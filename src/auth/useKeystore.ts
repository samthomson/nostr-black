import { useContext } from 'react';
import type { KeystoreContextType } from './keystoreContext';
import { KeystoreContext } from './keystoreContext';

/** Consumer-side hook for the keystore (kept here so the provider file
 * exports only components — react-refresh constraint). */
export const useKeystore = (): KeystoreContextType => {
  const ctx = useContext(KeystoreContext);
  if (!ctx) throw new Error('useKeystore must be used within KeystoreProvider');
  return ctx;
};
