"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { reportError } from "@/lib/observability/error-reporter";
import { cn } from "@/lib/utils";

type ErrorStateProps = {
  title: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  homeHref?: string;
  homeLabel?: string;
  digest?: string;
  headingLevel?: 1 | 2;
  className?: string;
};

export function ErrorState({
  title,
  description = "Vérifiez votre connexion, puis réessayez. Si le problème persiste, contactez votre administrateur.",
  onRetry,
  homeHref,
  homeLabel = "Retour à l’accueil",
  digest,
  headingLevel = 1,
  className,
}: ErrorStateProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <section
      role="alert"
      className={cn(
        "mx-auto flex max-w-xl flex-col items-center rounded-lg border border-border bg-surface px-6 py-12 text-center shadow-card",
        className
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-danger-subtle text-danger">
        <AlertTriangle aria-hidden="true" className="size-6" />
      </div>
      <Heading className="mt-4 text-xl font-semibold text-foreground">{title}</Heading>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {digest ? (
        <p className="mt-3 font-mono text-micro text-subtle-foreground">Référence : {digest}</p>
      ) : null}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {onRetry ? (
          <button type="button" onClick={onRetry} className={buttonVariants({ variant: "primary", size: "lg" })}>
            <RotateCcw aria-hidden="true" />
            Réessayer
          </button>
        ) : null}
        {homeHref ? (
          <Link href={homeHref} className={buttonVariants({ variant: "outline", size: "lg" })}>
            {homeLabel}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Body of every route `error.tsx`: reports the error once, names the screen that failed and
 * offers a retry (Next 16 `retry` re-fetches the segment) plus a way back.
 */
export function RouteError({
  error,
  retry,
  title,
  source,
  homeHref = "/dashboard",
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  title: string;
  source: string;
  homeHref?: string;
}) {
  useEffect(() => {
    reportError({
      error,
      source,
      context: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error, source]);

  return (
    <div className="py-8">
      <ErrorState title={title} onRetry={retry} homeHref={homeHref} digest={error.digest} />
    </div>
  );
}
