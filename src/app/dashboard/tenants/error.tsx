"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardTenantsError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="L’organisation n’a pas pu être chargée" source="route.tenants" />;
}
