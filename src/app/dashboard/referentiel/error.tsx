"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardReferentielError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Le référentiel n’a pas pu être chargé" source="route.referentiel" />;
}
