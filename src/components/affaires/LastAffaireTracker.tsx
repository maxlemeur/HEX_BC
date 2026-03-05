"use client";

import { useLayoutEffect } from "react";

import { setLastAffaire } from "@/hooks/useLastAffaireContext";

export function LastAffaireTracker({
  projectId,
}: Readonly<{
  projectId: string;
}>) {
  useLayoutEffect(() => {
    setLastAffaire(projectId);
  }, [projectId]);

  return null;
}
