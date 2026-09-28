/**
 * Merge relay-provenance maps: every relay an event was found on
 * accumulates (deduped) — one relay per note is a lie when three served it.
 */
export const mergeRelays = (
  into: Record<string, string[]>,
  from: Record<string, string[]>,
): Record<string, string[]> => {
  for (const [id, urls] of Object.entries(from)) {
    const existing = into[id] ?? [];
    into[id] = [...existing, ...urls.filter((u) => !existing.includes(u))];
  }
  return into;
};
