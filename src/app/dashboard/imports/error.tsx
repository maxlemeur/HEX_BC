"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardImportsError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="L’import DPGF n’a pas pu être chargé" source="route.imports" />;
}
