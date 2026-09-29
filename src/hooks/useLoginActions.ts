import { nip46Pool } from '@/net/nip46';
import type { NPool } from '@nostrify/nostrify';
import {
  NLogin,
  type NLoginType,
  type NostrConnectParams,
  type NostrConnectStatus,
  useNostrLogin,
} from '@nostrify/react/login';
import { useRouting } from '@/data/hooks/useRouting';

// NOTE: This file should not be edited except for adding new login methods.
// nostr.black supports signers only — there is intentionally no nsec method.

export type { NostrConnectParams, NostrConnectStatus };
export { generateNostrConnectParams, generateNostrConnectURI } from '@nostrify/react/login';

export function useLoginActions() {

  const { logins, addLogin, setLogin, removeLogin } = useNostrLogin();
  const { myWrite } = useRouting();

  // Add a login and promote it to be the current user. Without the
  // setLogin call the new login is appended to the end of the array,
  // leaving the prior account as logins[0] — which is what
  // useCurrentUser / useLoggedInAccounts treat as the active user.
  // Promoting here makes "Add another account" actually switch.
  const addAndActivate = (login: NLoginType) => {
    addLogin(login);
    setLogin(login.id);
  };

  return {
    // Login with a NIP-46 "bunker://" URI
    async bunker(uri: string): Promise<void> {
      const login = await NLogin.fromBunker(uri, nip46Pool as unknown as NPool);
      addAndActivate(login);
    },
    // Login with a NIP-07 browser extension
    async extension(): Promise<void> {
      const login = await NLogin.fromExtension();
      addAndActivate(login);
    },
    // Login via nostrconnect:// (client-initiated NIP-46)
    // The client displays a QR code and waits for the remote signer to connect.
    //
    // `onStatus` is forwarded from @nostrify/react so the UI can render
    // live progress through the handshake phases — see NostrConnectStatus.
    async nostrconnect(
      params: NostrConnectParams,
      signal?: AbortSignal,
      onStatus?: (status: NostrConnectStatus) => void,
    ): Promise<void> {
      const login = await NLogin.fromNostrConnect(params, nip46Pool as unknown as NPool, { signal, onStatus });
      addAndActivate(login);
    },
    // Get the relay URLs for NIP-46 nostrconnect communication. Our write
    // relays, falling back to discovery so the remote signer has several
    // connection options during the handshake.
    getRelayUrls(): string[] {
      return myWrite;
    },
    // Log out the current user
    async logout(): Promise<void> {
      const login = logins[0];
      if (login) {
        removeLogin(login.id);
      }
    }
  };
}
