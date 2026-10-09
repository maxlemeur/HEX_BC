"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardMembershipsError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Les membres de l’organisation n’ont pas pu être chargés" source="route.memberships" />;
}
