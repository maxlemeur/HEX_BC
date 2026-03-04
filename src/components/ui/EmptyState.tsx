import Link from "next/link";

import { cn } from "@/lib/utils";

export type EmptyStateProps = {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
  className,
}: Readonly<EmptyStateProps>) {
  const shouldRenderAction =
    Boolean(actionLabel) && (Boolean(actionHref) || Boolean(onAction));

  return (
    <div
      className={cn(
        "animate-fade-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/70 px-6 py-12 text-center",
        className
      )}
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white text-[var(--slate-400)] shadow-sm ring-1 ring-[var(--slate-200)]">
        {icon}
      </div>

      <h3 className="text-base font-semibold text-[var(--slate-800)]">
        {title}
      </h3>
      <p className="mt-1 max-w-md text-sm text-[var(--slate-500)]">
        {description}
      </p>

      {shouldRenderAction ? (
        onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="btn btn-primary btn-sm mt-5 inline-flex"
          >
            {actionLabel}
          </button>
        ) : (
          <Link href={actionHref!} className="btn btn-primary btn-sm mt-5 inline-flex">
            {actionLabel}
          </Link>
        )
      ) : null}
    </div>
  );
}
