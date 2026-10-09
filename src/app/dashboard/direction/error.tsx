"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardDirectionError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Le cockpit direction n’a pas pu être chargé" source="route.direction" />;
}
