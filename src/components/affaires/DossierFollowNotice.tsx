"use client";

import { Button } from "@/components/ui/button";
import type { AffaireDossier } from "./useAffaireDossier";

export type DossierFollow = { state: AffaireDossier["follow"]; onRefresh: () => void };

/**
 * What the page says while it waits on the dossier's analysis (useAffaireDossier): the brief is being prepared, then,
 * past the server's own limits, that it may be ready, with « Actualiser ». Nothing once the server recorded the end.
 */
export function DossierFollowNotice({ follow }: { follow: DossierFollow | null | undefined }) {
  if (!follow || follow.state === "idle") return null;
  if (follow.state === "waiting") {
    return <p className="affaire-workbench-note" role="status">Analyse des pièces en cours : le brief est en préparation.</p>;
  }
  return (
    <div className="affaire-workbench-note" role="status">
      <p>L’analyse dure plus longtemps que prévu : le brief est peut-être prêt.</p>
      <Button type="button" variant="outline" size="sm" onClick={follow.onRefresh}>Actualiser</Button>
    </div>
  );
}
