"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  // A query-only navigation cannot reset this route's existing error boundary.
  return <RouteError error={error} retry={retry} title="Cette page n’a pas pu être chargée" source="route.dashboard" reloadHome />;
}
