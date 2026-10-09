"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAffairesError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="La liste des affaires n’a pas pu être chargée" source="route.affaires" />;
}
