"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAdminError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Cette page d’administration n’a pas pu être chargée" source="route.admin" />;
}
