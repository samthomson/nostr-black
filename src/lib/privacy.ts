/**
 * Privacy grades — the app's colour semantics. Private is black, public is
 * white; shades of grey between express how private a thing is. Every
 * colour a surface wears comes from here: background, complementary text,
 * nested soft surfaces, soft text. The CSS custom properties are defined
 * once in src/index.css — this module is their typed face.
 *
 * Hover shifts one step toward the mid-scale and re-asserts text colour so
 * default button hover (light primary) can never wash out the label.
 */

export type PrivacyGrade = 'private' | 'high' | 'medium' | 'low' | 'public';

export interface PrivacyStyle {
  /** Solid background for buttons/pills/surfaces (CSS var reference). */
  bg: string;
  /** Complementary text colour — guaranteed readable on `bg`. */
  fg: string;
  /** Subtle nested surface on `bg` (rows, wells, insets). */
  soft: string;
  /** Soft/secondary text on `bg` (timestamps, meta rows). */
  muted: string;
  /** Classes for interactive chrome (buttons/pills): bg + fg + hover.
   * Surfaces pass `surface` — no hover shift, nothing suggests a click. */
  className: string;
  /** Static surface classes: grade bg + complementary fg, no hover. */
  surface: string;
  /** Grade name for labels. */
  label: string;
}

/** Per-grade utility suffixes — the one list of what a grade defines. */
const TOKEN: Record<PrivacyGrade, { fg: string; soft: string; muted: string }> = {
  private: { fg: 'privacy-private-fg', soft: 'privacy-private-soft', muted: 'privacy-private-muted' },
  high: { fg: 'privacy-high-fg', soft: 'privacy-high-soft', muted: 'privacy-high-muted' },
  medium: { fg: 'privacy-medium-fg', soft: 'privacy-medium-soft', muted: 'privacy-medium-muted' },
  low: { fg: 'privacy-low-fg', soft: 'privacy-low-soft', muted: 'privacy-low-muted' },
  public: { fg: 'privacy-public-fg', soft: 'privacy-public-soft', muted: 'privacy-public-muted' },
};

export const PRIVACY: Record<PrivacyGrade, PrivacyStyle> = {
  private: {
    bg: 'var(--privacy-private)',
    fg: 'var(--privacy-private-fg)',
    soft: 'var(--privacy-private-soft)',
    muted: 'var(--privacy-private-muted)',
    className:
      'bg-privacy-private text-privacy-private-fg hover:bg-privacy-high hover:text-privacy-private-fg',
    surface: 'bg-privacy-private text-privacy-private-fg',
    label: 'private',
  },
  high: {
    bg: 'var(--privacy-high)',
    fg: 'var(--privacy-high-fg)',
    soft: 'var(--privacy-high-soft)',
    muted: 'var(--privacy-high-muted)',
    className:
      'bg-privacy-high text-privacy-high-fg hover:bg-privacy-medium hover:text-privacy-high-fg',
    surface: 'bg-privacy-high text-privacy-high-fg',
    label: 'high privacy',
  },
  medium: {
    bg: 'var(--privacy-medium)',
    fg: 'var(--privacy-medium-fg)',
    soft: 'var(--privacy-medium-soft)',
    muted: 'var(--privacy-medium-muted)',
    className:
      'bg-privacy-medium text-privacy-medium-fg hover:bg-privacy-high hover:text-privacy-medium-fg',
    surface: 'bg-privacy-medium text-privacy-medium-fg',
    label: 'medium privacy',
  },
  low: {
    bg: 'var(--privacy-low)',
    fg: 'var(--privacy-low-fg)',
    soft: 'var(--privacy-low-soft)',
    muted: 'var(--privacy-low-muted)',
    className:
      'bg-privacy-low text-privacy-low-fg hover:bg-privacy-public hover:text-privacy-low-fg',
    surface: 'bg-privacy-low text-privacy-low-fg',
    label: 'low privacy',
  },
  public: {
    bg: 'var(--privacy-public)',
    fg: 'var(--privacy-public-fg)',
    soft: 'var(--privacy-public-soft)',
    muted: 'var(--privacy-public-muted)',
    className:
      'bg-privacy-public text-privacy-public-fg hover:bg-privacy-low hover:text-privacy-public-fg',
    surface: 'bg-privacy-public text-privacy-public-fg',
    label: 'public',
  },
};

/**
 * Classes for content living on a grade's surface: soft nested surfaces
 * (`bg-…-soft`) and soft text (`text-…-muted`). Use these instead of
 * theme tokens (bg-muted, text-muted-foreground) inside any
 * privacy-graded surface — theme tokens assume the app background.
 */
export const onGrade = (grade: PrivacyGrade): { soft: string; muted: string } => ({
  soft: `bg-${TOKEN[grade].soft} text-${TOKEN[grade].fg}`,
  muted: `text-${TOKEN[grade].muted}`,
});

/**
 * Shared chrome for privacy-grade buttons. Pair with `PRIVACY[grade].className`
 * and `variant="privacy"` so the default Button hover cannot override colours.
 */
export const PRIVACY_BUTTON = 'h-8 gap-2 rounded-sm px-3 text-sm font-medium';

/** Ordered dark→light for pickers/legends. */
export const PRIVACY_ORDER: PrivacyGrade[] = ['private', 'high', 'medium', 'low', 'public'];

/** Neighbouring grades — for "more/less private" controls. */
export const nextMorePrivate = (grade: PrivacyGrade): PrivacyGrade => {
  const i = PRIVACY_ORDER.indexOf(grade);
  return PRIVACY_ORDER[Math.max(0, i - 1)];
};

export const nextLessPrivate = (grade: PrivacyGrade): PrivacyGrade => {
  const i = PRIVACY_ORDER.indexOf(grade);
  return PRIVACY_ORDER[Math.min(PRIVACY_ORDER.length - 1, i + 1)];
};
