"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardApprovalsError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="La file d’approbation n’a pas pu être chargée" source="route.approvals" />;
}
