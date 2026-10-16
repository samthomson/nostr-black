import { ChevronDown, LogOut } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
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
import { clipMiddle } from '@/lib/format';

/**
 * The account chip: profile link, plus logout — which flushes the stored
 * nsec and zeroes the session key.
 */
export function AccountSwitcher() {
  const { user: activeUser } = useCurrentUser();
  const { metadata } = useProfile(activeUser?.pubkey);
  const { logout } = useKeystore();
  const navigate = useNavigate();

  if (!activeUser) return null;

  const npub = nip19.npubEncode(activeUser.pubkey);
  const displayNpub = clipMiddle(npub);
  const displayName = metadata?.display_name || metadata?.name || displayNpub;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button className='flex items-center gap-2 h-10 w-full p-1 pr-2.5 rounded-sm bg-accent text-foreground cursor-pointer transition-colors hover:bg-foreground/20 data-[state=open]:bg-foreground/20'>
          <ProfileAvatar pubkey={activeUser.pubkey} metadata={metadata} className="size-8 shrink-0" />
          <span className='flex-1 min-w-0 truncate text-left text-sm font-medium'>{displayName}</span>
          <ChevronDown className='w-4 h-4 shrink-0' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-[var(--radix-dropdown-menu-trigger-width)] p-2 animate-scale-in'>
        <DropdownMenuItem asChild className='flex items-center gap-2 cursor-pointer p-2 rounded-sm'>
          <Link to={`/${npub}`}>
            <ProfileAvatar pubkey={activeUser.pubkey} metadata={metadata} className="size-8" />
            <div className='flex-1 truncate'>
              <p className='text-sm font-medium'>{displayName}</p>
            </div>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => { logout(); navigate('/', { replace: true }); }}
          className='flex items-center gap-2 cursor-pointer p-2 rounded-sm text-red-500'
        >
          <LogOut className='w-4 h-4' />
          <span>log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
