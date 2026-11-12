"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAffairesProjectIdMaterialRequestsError({
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
      title="Les demandes de matériel n’ont pas pu être chargées"
      source="route.affaires.material-requests"
    />
  );
}
