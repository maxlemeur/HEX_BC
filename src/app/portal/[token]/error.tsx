"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/layout/error-state";
import { reportError } from "@/lib/observability/error-reporter";

export default function PortalError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  useEffect(() => {
    reportError({
      error,
      source: "route.portal",
      context: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  return (
    <div className="py-10">
      <ErrorState
        title="Ce devis n’a pas pu être affiché"
        description="Le service est momentanément indisponible. Réessayez dans quelques instants ou contactez votre interlocuteur."
        onRetry={retry}
        digest={error.digest}
      />
    </div>
  );
}
