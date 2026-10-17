import { useContext } from 'react';
import { UserStateContext, type UserStateContextType } from '@/contexts/UserStateContext';

/** Access synced user nostr state (relay list, follows). */
export function useUserState(): UserStateContextType {
  const ctx = useContext(UserStateContext);
  if (!ctx) throw new Error('useUserState must be used within UserStateProvider');
  return ctx;
}
