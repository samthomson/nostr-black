/**
 * NIP-01 hashtags: the `t` tags a note carries so other clients can
 * browse by tag. Derived from the content at publish time — the same
 * content-is-the-source-of-truth rule as NIP-27 mentions, so modal
 * edits can never orphan a tag.
 */

const HASHTAG_PATTERN = /(^|\s)#([a-zA-Z0-9_]+)/g;

/** Hashtag values in the content, lowercased and deduped in order of
 * first appearance. A `#` inside a URL (`…/file#anchor`) is not a
 * hashtag: only whitespace or start-of-content introduces one. */
export const hashtagsOf = (content: string): string[] => {
  const seen = new Set<string>();
  const found: string[] = [];
  for (const [, , word] of content.matchAll(HASHTAG_PATTERN)) {
    const value = word.toLowerCase();
    if (seen.has(value)) continue;
    seen.add(value);
    found.push(value);
  }
  return found;
};

/** The `t` tags for a note's content. */
export const tTagsOf = (content: string): string[][] =>
  hashtagsOf(content).map((value) => ['t', value]);
