"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAffairesProjectIdPlansError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Les plans de l’affaire n’ont pas pu être chargés" source="route.affaires.plans" />;
}
