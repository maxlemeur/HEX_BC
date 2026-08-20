"use client";

import { Badge } from "@/components/ui-legacy/Badge";
import type { AffaireStatus } from "./types";

const STATUS_BADGE_VARIANT: Record<
  AffaireStatus,
  "neutral" | "info" | "success"
> = {
  draft: "neutral",
  sending: "info",
  sent: "info",
  accepted: "success",
  archived: "neutral",
};

const STATUS_LABEL: Record<AffaireStatus, string> = {
  draft: "Brouillon",
  sending: "Envoi en cours",
  sent: "Envoyé",
  accepted: "Accepté",
  archived: "Archivé",
};

type Props = {
  currentVersionNumber: number;
  currentStatus: AffaireStatus;
  acceptedVersionNumber: number | null;
};

export function AffaireStatusBadges({
  currentVersionNumber,
  currentStatus,
  acceptedVersionNumber,
}: Readonly<Props>) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Badge variant={STATUS_BADGE_VARIANT[currentStatus]} size="sm">
        V{currentVersionNumber} - {STATUS_LABEL[currentStatus]}
      </Badge>
      {acceptedVersionNumber !== null && (
        <Badge variant="success" size="sm">
          V{acceptedVersionNumber} acceptée
        </Badge>
      )}
    </div>
  );
}
