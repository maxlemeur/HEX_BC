"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Cette page n’a pas pu être chargée" source="route.dashboard" />;
}
