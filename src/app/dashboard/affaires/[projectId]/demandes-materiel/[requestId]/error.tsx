"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAffairesProjectIdMaterialRequestError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return (
    <RouteError
      error={error}
      retry={retry}
      title="La demande de matériel n’a pas pu être chargée"
      source="route.affaires.material-request"
    />
  );
}
