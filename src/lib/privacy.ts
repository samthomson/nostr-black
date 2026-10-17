/**
 * Privacy grades — the app's colour semantics. Private is black, public is
 * white; shades of grey between express how private a thing is. Text on a
 * grade is always the inversion. Every button, pill and label that carries
 * privacy meaning uses these consts — never an ad-hoc colour.
 *
 * Hover shifts one step toward the mid-scale and re-asserts text colour so
 * default button hover (light primary) can never wash out the label.
 */

export type PrivacyGrade = 'private' | 'high' | 'medium' | 'low' | 'public';

export interface PrivacyStyle {
  /** Solid background for buttons/pills (CSS var reference). */
  bg: string;
  /** Inverted text colour for use on `bg`. */
  fg: string;
  /** Tailwind class set (bg + fg + hover), ready for className use. */
  className: string;
  /** Grade name for labels. */
  label: string;
}

export const PRIVACY: Record<PrivacyGrade, PrivacyStyle> = {
  private: {
    bg: 'var(--privacy-private)',
    fg: 'var(--privacy-public)',
    className:
      'bg-privacy-private text-privacy-public hover:bg-privacy-high hover:text-privacy-public',
    label: 'private',
  },
  high: {
    bg: 'var(--privacy-high)',
    fg: 'var(--privacy-public)',
    className:
      'bg-privacy-high text-privacy-public hover:bg-privacy-medium hover:text-privacy-public',
    label: 'high privacy',
  },
  medium: {
    bg: 'var(--privacy-medium)',
    fg: 'var(--privacy-public)',
    className:
      'bg-privacy-medium text-privacy-public hover:bg-privacy-high hover:text-privacy-public',
    label: 'medium privacy',
  },
  low: {
    bg: 'var(--privacy-low)',
    fg: 'var(--privacy-private)',
    className:
      'bg-privacy-low text-privacy-private hover:bg-privacy-public hover:text-privacy-private',
    label: 'low privacy',
  },
  public: {
    bg: 'var(--privacy-public)',
    fg: 'var(--privacy-private)',
    className:
      'bg-privacy-public text-privacy-private hover:bg-privacy-low hover:text-privacy-private',
    label: 'public',
  },
};

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
