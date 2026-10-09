import { cn } from "@/lib/utils";

type HeadingLevel = 1 | 2 | 3 | 4;

type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  /** Button(s) or link(s) that let the user get out of the empty state. */
  action?: React.ReactNode;
  headingLevel?: HeadingLevel;
  /** `card`: dashed panel; `plain`: no frame (inside an existing card); `compact`: inline, smaller. */
  variant?: "card" | "plain" | "compact";
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 3,
  variant = "card",
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  const compact = variant === "compact";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        variant === "card" && "rounded-lg border border-dashed border-border bg-surface-subtle px-6 py-12",
        variant === "plain" && "px-6 py-10",
        compact && "px-4 py-6",
        className
      )}
    >
      {icon ? (
        <div
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center rounded-full bg-surface text-subtle-foreground shadow-xs ring-1 ring-border [&_svg]:shrink-0",
            compact ? "mb-2 size-9 [&_svg]:size-4" : "mb-4 size-12 [&_svg]:size-5"
          )}
        >
          {icon}
        </div>
      ) : null}
      <Heading className={cn("font-semibold text-foreground", compact ? "text-sm" : "text-base")}>
        {title}
      </Heading>
      {description ? (
        <p className={cn("mt-1 max-w-md text-muted-foreground", compact ? "text-xs" : "text-sm")}>
          {description}
        </p>
      ) : null}
      {action ? <div className={cn("flex flex-wrap justify-center gap-2", compact ? "mt-3" : "mt-5")}>{action}</div> : null}
    </div>
  );
}

/** Empty state spanning a whole table body. */
export function EmptyTableRow({
  colSpan,
  ...props
}: EmptyStateProps & { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <EmptyState variant="plain" {...props} />
      </td>
    </tr>
  );
}
