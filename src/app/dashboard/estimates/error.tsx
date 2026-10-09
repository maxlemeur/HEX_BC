"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardEstimatesError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Ce chiffrage n’a pas pu être chargé" source="route.estimates" />;
}
