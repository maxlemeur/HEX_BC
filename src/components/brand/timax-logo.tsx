import { cn } from "@/lib/utils";

/** Product monogram, used where the tenant logo used to be hard-coded. */
export function TimaxMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-orange font-display text-base font-extrabold text-white shadow-[inset_0_-2px_0_rgb(0_0_0/0.15)]",
        className
      )}
    >
      T
    </span>
  );
}

/** Product name, optionally followed by the active organisation. */
export function TimaxWordmark({
  tenantName,
  className,
  tenantClassName,
}: {
  tenantName?: string | null;
  className?: string;
  tenantClassName?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-2", className)}>
      <span className="font-display font-extrabold tracking-tight">TIMAX</span>
      {tenantName ? (
        <span className={cn("min-w-0 truncate text-xs font-medium opacity-70", tenantClassName)}>{tenantName}</span>
      ) : null}
    </span>
  );
}
