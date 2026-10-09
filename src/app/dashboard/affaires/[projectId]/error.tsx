"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAffairesProjectIdError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="L’affaire n’a pas pu être chargée" source="route.affaires.hub" />;
}
