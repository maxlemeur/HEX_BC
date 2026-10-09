"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardTakeoffError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Les métrés n’ont pas pu être chargés" source="route.takeoff" />;
}
