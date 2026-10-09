"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardCatalogueError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Le catalogue n’a pas pu être chargé" source="route.catalogue" />;
}
