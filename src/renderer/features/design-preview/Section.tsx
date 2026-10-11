import { useId, type ReactNode } from 'react';

/** One titled region of the design preview: an `h2` that names a `section` landmark. */
export function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="border-t border-border pt-10 first:border-t-0 first:pt-0"
    >
      <h2 id={id} className="text-2xl font-semibold text-fg">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-fg-secondary">{intro}</p>
      <div className="mt-8">{children}</div>
    </section>
  );
}
