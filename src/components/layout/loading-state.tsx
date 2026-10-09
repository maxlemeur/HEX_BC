import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/** Inline loading message announced to assistive technologies. */
export function LoadingState({
  label = "Chargement…",
  className,
  testId,
}: {
  label?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      className={cn("flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground", className)}
    >
      <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
      <span>{label}</span>
    </div>
  );
}
