"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardProfileError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="Votre profil n’a pas pu être chargé" source="route.profile" />;
}
