import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)} />;
}

type PageSkeletonVariant = "list" | "detail" | "dashboard" | "form" | "workspace";

/**
 * Route-level placeholder for `loading.tsx`: mirrors the page header and the main layout
 * of each screen family so content does not jump when it streams in.
 */
export function PageSkeleton({
  variant = "list",
  label = "Chargement de la page…",
}: {
  variant?: PageSkeletonVariant;
  label?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="w-full">
      <span className="sr-only">{label}</span>
      <div className="mb-8 flex flex-col gap-3">
        <Bone className="h-4 w-40" />
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-2">
            <Bone className="h-8 w-64 max-w-full" />
            <Bone className="h-4 w-96 max-w-full" />
          </div>
          <Bone className="h-10 w-36" />
        </div>
      </div>

      {variant === "dashboard" ? (
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <Bone key={index} className="h-24" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <Bone className="h-72" />
            <Bone className="h-72" />
          </div>
        </div>
      ) : null}

      {variant === "list" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Bone className="h-10 w-full sm:w-72" />
            <Bone className="h-10 w-32" />
            <Bone className="h-10 w-32" />
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <Bone className="h-11 rounded-none" />
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="flex items-center gap-4 border-t border-border-subtle px-4 py-3.5">
                <Bone className="h-4 flex-1" />
                <Bone className="hidden h-4 w-24 sm:block" />
                <Bone className="h-6 w-20 rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {variant === "detail" ? (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-4">
            <Bone className="h-40" />
            <Bone className="h-64" />
          </div>
          <div className="flex flex-col gap-4">
            <Bone className="h-32" />
            <Bone className="h-48" />
          </div>
        </div>
      ) : null}

      {variant === "form" ? (
        <div className="flex max-w-2xl flex-col gap-5 rounded-lg border border-border bg-surface p-6">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Bone className="h-4 w-32" />
              <Bone className="h-10" />
            </div>
          ))}
        </div>
      ) : null}

      {variant === "workspace" ? (
        <div className="flex flex-col gap-3">
          <Bone className="h-12" />
          <Bone className="h-[60vh]" />
        </div>
      ) : null}
    </div>
  );
}
