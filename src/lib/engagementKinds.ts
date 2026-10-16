/**
 * Engagement constants: the kinds the viewer can list people for, and
 * the emoji a plain heart-click broadcasts. Lib, not a component file,
 * so fast-refresh boundaries stay clean.
 */

/** The viewer's tabs. Replies and quotes are not here: they are notes,
 * opened with the existing note-opening UI, not listed as people. */
export const ENGAGEMENT_TABS = ['reactions', 'reposts'] as const;
export type EngagementTab = (typeof ENGAGEMENT_TABS)[number];

/** The long-press picker's choices — '+' is the NIP-25 default. */
export const EMOJI_CHOICES = ['+', '❤', '😂', '🙏', '🔥', '👏', '😭', '🤔'] as const;
