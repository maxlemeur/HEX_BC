"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAffairesProjectIdTakeoffError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Le centre des métrés n’a pas pu être chargé" source="route.affaires.takeoff" />;
}
