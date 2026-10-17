/** Shared chrome for one settings panel. */
export const Section = ({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-3 rounded-sm border p-4">
    <h2 className="text-sm font-semibold uppercase tracking-wide">
      {title}
      {hint && (
        <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground text-xs">
          {hint}
        </span>
      )}
    </h2>
    {children}
  </section>
);
