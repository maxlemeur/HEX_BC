"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardIndicesError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Les indices matière n’ont pas pu être chargés" source="route.indices" />;
}
