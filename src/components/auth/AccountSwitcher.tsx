import { ChevronDown, LogOut, Lock, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.tsx';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useLoggedInAccounts, type Account } from '@/hooks/useLoggedInAccounts';
import { useKeystore } from '@/auth/useKeystore';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface AccountSwitcherProps {
  onAddAccountClick: () => void;
}

/**
 * Unified account chip: one dropdown for whoever is active — a memory-only
 * keystore session (lock) or a persisted signer login (switch/logout), plus
 * the persisted account list and add-account. One UX, two login sources.
 */
export function AccountSwitcher({ onAddAccountClick }: AccountSwitcherProps) {
  const { user: activeUser, metadata } = useCurrentUser();
  const { otherUsers, setLogin, removeLogin } = useLoggedInAccounts();
  const { unlocked: keystoreActive, pubkey: keystorePubkey, logout: lockKeystore } = useKeystore();

  if (!activeUser) return null;

  const isKeystore = keystoreActive && keystorePubkey === activeUser.pubkey;
  const npub = nip19.npubEncode(activeUser.pubkey);
  const displayNpub = `${npub.slice(0, 10)}…`;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className='flex items-center gap-2 h-10 p-1 pr-2.5 rounded-sm hover:bg-accent transition-all text-foreground'>
          <ProfileAvatar pubkey={activeUser.pubkey} metadata={metadata} className="size-8" />
          {isKeystore && (
            <span className='text-muted-foreground text-xs font-mono'>key</span>
          )}
          <ChevronDown className='w-4 h-4 text-muted-foreground' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-56 p-2 animate-scale-in'>
        <DropdownMenuItem asChild className='flex items-center gap-2 cursor-pointer p-2 rounded-md'>
          <Link to={`/${npub}`}>
            <ProfileAvatar pubkey={activeUser.pubkey} metadata={metadata} className="size-8" />
            <div className='flex-1 truncate'>
              <p className='text-sm font-medium'>{metadata?.name ?? displayNpub}</p>
            </div>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {isKeystore ? (
          <DropdownMenuItem
            onClick={lockKeystore}
            className='flex items-center gap-2 cursor-pointer p-2 rounded-md text-red-500'
          >
            <Lock className='w-4 h-4' />
            <span>lock session (zero the key)</span>
          </DropdownMenuItem>
        ) : (
          <>
            {otherUsers.map((user: Account) => (
              <DropdownMenuItem
                key={user.id}
                onClick={() => setLogin(user.id)}
                className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
              >
                <ProfileAvatar pubkey={user.pubkey} metadata={user.metadata} className="size-8" />
                <div className='flex-1 truncate'>
                  <p className='text-sm font-medium'>
                    {user.metadata.name ?? `${nip19.npubEncode(user.pubkey).slice(0, 10)}…`}
                  </p>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem
              onClick={onAddAccountClick}
              className='flex items-center gap-2 cursor-pointer p-2 rounded-md'
            >
              <UserPlus className='w-4 h-4' />
              <span>add another account</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => removeLogin(`extension:${activeUser.pubkey}`)}
              className='flex items-center gap-2 cursor-pointer p-2 rounded-md text-red-500'
            >
              <LogOut className='w-4 h-4' />
              <span>log out</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
