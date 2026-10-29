"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAffairesProjectIdError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  const retryPage = error?.name === "ChunkLoadError" ? () => window.location.reload() : retry;

  return <RouteError error={error} retry={retryPage} title="L’affaire n’a pas pu être chargée" source="route.affaires.hub" />;
}
