import { useSeoMeta } from '@unhead/react';
import { PrivacyTag } from '@/components/PrivacyTag';
import { NoteComposer } from '@/components/NoteComposer';
import { Feed } from '@/components/Feed';
import { FeedKindMenu } from '@/components/FeedKindMenu';
import { Page } from '@/components/Page';
import { TorGate } from '@/components/TorGate';

/** The public feed — `/public-feed`, the explicit twin of `/private-feed`. */
const PublicFeed = () => {
  useSeoMeta({ title: 'public feed — nostr.black' });

  return (
    <TorGate>
      <Page
        title={<PrivacyTag grade="public">public feed</PrivacyTag>}
        actions={<FeedKindMenu />}
      >
        <NoteComposer />
        <Feed />
      </Page>
    </TorGate>
  );
};

export default PublicFeed;
