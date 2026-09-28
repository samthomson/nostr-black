import { PRIVACY, type PrivacyGrade } from '@/lib/privacy';
import type { ReactNode } from 'react';

/**
 * A privacy pill: solid grade colour with inverted text — the canonical
 * rendering of privacy meaning anywhere in the app. Inherits font-size from
 * the surrounding text (never forces one). Optional children override the
 * default grade label.
 */
export const PrivacyTag = ({
  grade,
  className = '',
  children,
}: {
  grade: PrivacyGrade;
  className?: string;
  children?: ReactNode;
}) => {
  const style = PRIVACY[grade];
  return (
    <span
      className={`inline-flex items-center rounded-sm px-[0.35em] py-[0.1em] align-middle font-mono leading-none ${style.className} ${className}`}
    >
      {children ?? style.label}
    </span>
  );
};
