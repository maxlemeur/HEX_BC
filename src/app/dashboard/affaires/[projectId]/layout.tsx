"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";

import { setLastAffaire } from "@/hooks/useLastAffaireContext";

export default function AffaireProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ projectId: string }>();

  useEffect(() => {
    if (params.projectId) setLastAffaire(params.projectId);
  }, [params.projectId]);

  return <>{children}</>;
}
