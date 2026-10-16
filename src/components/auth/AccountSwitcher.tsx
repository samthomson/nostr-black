import { ChevronDown, LogOut } from 'lucide-react';
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
import { useKeystore } from '@/auth/useKeystore';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useProfile } from '@/data/hooks/useProfile';

/**
 * The account chip: profile link, plus logout — which flushes the stored
 * nsec and zeroes the session key.
 */
export function AccountSwitcher() {
  const { user: activeUser } = useCurrentUser();
  const { metadata } = useProfile(activeUser?.pubkey);
  const { logout } = useKeystore();

  if (!activeUser) return null;

  const npub = nip19.npubEncode(activeUser.pubkey);
  const displayNpub = `${npub.slice(0, 10)}…`;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className='flex items-center gap-2 h-10 p-1 pr-2.5 rounded-sm hover:bg-accent transition-all text-foreground'>
          <ProfileAvatar pubkey={activeUser.pubkey} metadata={metadata} className="size-8" />
          <ChevronDown className='w-4 h-4 text-muted-foreground' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-56 p-2 animate-scale-in'>
        <DropdownMenuItem asChild className='flex items-center gap-2 cursor-pointer p-2 rounded-sm'>
          <Link to={`/${npub}`}>
            <ProfileAvatar pubkey={activeUser.pubkey} metadata={metadata} className="size-8" />
            <div className='flex-1 truncate'>
              <p className='text-sm font-medium'>{metadata?.name ?? displayNpub}</p>
            </div>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={logout}
          className='flex items-center gap-2 cursor-pointer p-2 rounded-sm text-red-500'
        >
          <LogOut className='w-4 h-4' />
          <span>log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
