import { cn } from "@/lib/utils";

type PageSectionProps = {
  title: React.ReactNode;
  /** Heading id; derived from a string title when omitted. */
  id?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  headingLevel?: 2 | 3;
  /** `card` wraps the section in a surface; `plain` only adds the heading row. */
  variant?: "card" | "plain";
  /** Remove the body padding (tables, lists that run edge to edge). */
  flush?: boolean;
  children: React.ReactNode;
  className?: string;
};

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function PageSection({
  title,
  id,
  description,
  actions,
  headingLevel = 2,
  variant = "card",
  flush = false,
  children,
  className,
}: PageSectionProps) {
  const headingId = id ?? (typeof title === "string" ? `section-${slugify(title)}` : undefined);
  const Heading = `h${headingLevel}` as const;
  const isCard = variant === "card";

  return (
    <section
      aria-labelledby={headingId}
      className={cn(isCard && "min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card", className)}
    >
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-3",
          isCard ? "border-b border-border-subtle px-4 py-4 sm:px-5" : "mb-4"
        )}
      >
        <div className="min-w-0">
          <Heading id={headingId} className="font-semibold text-foreground">
            {title}
          </Heading>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className={cn(isCard && !flush && "p-4 sm:p-5")}>{children}</div>
    </section>
  );
}
