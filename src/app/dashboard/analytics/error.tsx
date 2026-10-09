"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAnalyticsError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Les performances n’ont pas pu être chargées" source="route.analytics" />;
}
