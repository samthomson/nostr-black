import { PRIVACY, type PrivacyGrade } from '@/lib/privacy';
import type { ReactNode } from 'react';

/** One grade — or a pair, which renders the split "mixed" tag. */
export type PrivacyTagGrade = PrivacyGrade | readonly [PrivacyGrade, PrivacyGrade];

const isPair = (grade: PrivacyTagGrade): grade is readonly [PrivacyGrade, PrivacyGrade] =>
  Array.isArray(grade);

/** Hard diagonal edge: each colour doubled around 50% so no seam shows. */
const SPLIT = (c: string) => `${c} 49.6%, ${c} 50.4%`;

/**
 * A privacy pill: solid grade colour with inverted text — the canonical
 * rendering of privacy meaning anywhere in the app. Inherits font-size from
 * the surrounding text (never forces one). Optional children override the
 * default grade label.
 *
 * A pair of grades renders the mixed tag: the background splits diagonally
 * from the first grade's corner to the second's, and the text carries the
 * same split inverted so every glyph reads on both halves.
 */
export const PrivacyTag = ({
  grade,
  className = '',
  children,
}: {
  grade: PrivacyTagGrade;
  className?: string;
  children?: ReactNode;
}) => {
  if (!isPair(grade)) {
    const style = PRIVACY[grade];
    return (
      <span
        className={`inline-flex items-center rounded-sm px-[0.35em] py-[0.1em] align-middle ${style.className} ${className}`}
      >
        {children ?? style.label}
      </span>
    );
  }
  const [a, b] = grade.map((g) => PRIVACY[g]);
  return (
    <span
      className={`inline-flex items-center rounded-sm px-[0.35em] py-[0.1em] align-middle ${className}`}
      style={{ backgroundImage: `linear-gradient(to bottom right, ${SPLIT(a.bg)}, ${SPLIT(b.bg)})` }}
    >
      <span
        className="bg-clip-text text-transparent"
        style={{ backgroundImage: `linear-gradient(to bottom right, ${SPLIT(a.fg)}, ${SPLIT(b.fg)})` }}
      >
        {children ?? 'mixed'}
      </span>
    </span>
  );
};
