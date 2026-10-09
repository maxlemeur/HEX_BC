"use client";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { AffaireStatus } from "./types";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

const STATUS_BADGE_VARIANT: Record<AffaireStatus, BadgeVariant> = {
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

const APPROVAL_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  required: { label: "À valider", variant: "warning" },
  in_review: { label: "En revue", variant: "info" },
  approved: { label: "Approuvée", variant: "success" },
  changes_requested: { label: "À reprendre", variant: "danger" },
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
      <Badge variant={STATUS_BADGE_VARIANT[currentStatus]}>
        V{currentVersionNumber} - {STATUS_LABEL[currentStatus]}
      </Badge>
      {acceptedVersionNumber !== null && (
        <Badge variant="success">V{acceptedVersionNumber} acceptée</Badge>
      )}
    </div>
  );
}

/** Internal approval state of the current version, or null when none is tracked. */
export function AffaireApprovalBadge({
  approvalStatus,
}: Readonly<{ approvalStatus: string | null }>) {
  const badge = approvalStatus ? APPROVAL_BADGE[approvalStatus] : undefined;
  if (!badge) return null;
  return <Badge variant={badge.variant}>{badge.label}</Badge>;
}
