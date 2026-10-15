import { publish as publishEvent } from "@/net/net";
import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { useCurrentUser } from "./useCurrentUser";
import { useRouting } from '@/data/hooks/useRouting';

import { clientTag } from "@/lib/clientTag";
import { eventTooLarge } from "@/lib/eventSize";
import { toast } from "@/hooks/useToast";
import type { NostrEvent } from "@nostrify/nostrify";

type EventTemplate = Pick<NostrEvent, 'kind' | 'content'> &
  Partial<Pick<NostrEvent, 'tags' | 'created_at'>>;

export function useNostrPublish(): UseMutationResult<
  NostrEvent,
  Error,
  EventTemplate
> {
  const { user } = useCurrentUser();
  const { relays } = useRouting();

  return useMutation({
    mutationFn: async (t: EventTemplate) => {
      if (user) {
        // The client tag reflects the client actually publishing — any
        // existing one is replaced, never inherited from a prior publisher.
        const tags = (t.tags ?? []).filter(([name]) => name !== "client");
        const tag = clientTag();
        if (tag) tags.push(["client", tag]);

        const event = await user.signer.signEvent({
          kind: t.kind,
          content: t.content ?? "",
          tags,
          created_at: t.created_at ?? Math.floor(Date.now() / 1000),
        });

        if (eventTooLarge(event)) {
          toast({
            title: "large event",
            description: "over the usual 64 KB relay limit — some relays may reject it",
          });
        }
        await publishEvent(event, relays({ kind: 'publish', event }));
        return event;
      } else {
        throw new Error("User is not logged in");
      }
    },
    onError: (error) => {
      console.error("Failed to publish event:", error);
    },
    onSuccess: (data) => {
      console.log("Event published successfully:", data);
    },
  });
}
