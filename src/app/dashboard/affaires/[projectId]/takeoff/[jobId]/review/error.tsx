"use client";

import { RouteError } from "@/components/layout/error-state";

export default function DashboardAffairesProjectIdTakeoffJobIdReviewError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return <RouteError error={error} retry={retry} title="La revue du métré n’a pas pu être chargée" source="route.affaires.takeoff.review" />;
}
