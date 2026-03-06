"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useToast } from "@/components/ui/Toast";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { Database } from "@/types/database";

type TenantRole = Database["public"]["Enums"]["tenant_role"];

type ApiEnvelope = {
  error?: {
    message?: string;
  };
};

async function postApprovalAction(versionId: string, body: Record<string, string>) {
  const response = await fetch(`/api/estimates/${versionId}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.ok) {
    return;
  }

  const payload = (await response.json().catch(() => null)) as ApiEnvelope | null;
  throw new Error(
    payload?.error?.message ?? "Impossible de mettre a jour l'approbation."
  );
}

export function EstimateApprovalActions({
  versionId,
  summary,
  tenantRole,
}: Readonly<{
  versionId: string;
  summary: EstimateApprovalSummary;
  tenantRole: TenantRole | null;
}>) {
  const router = useRouter();
  const toast = useToast();
  const [isPending, startTransition] = useTransition();

  const requestableReasons = summary.reasons.filter(
    (reason) => reason.approvalStatus === "missing" || reason.approvalStatus === "rejected"
  );
  const pendingReasons = summary.reasons.filter(
    (reason) => reason.approvalStatus === "pending" && reason.approvalId
  );

  const canRequest =
    (tenantRole === "admin" || tenantRole === "engineer") &&
    requestableReasons.length > 0;
  const canDecide =
    (tenantRole === "admin" || tenantRole === "director") &&
    pendingReasons.length > 0;

  if (!canRequest && !canDecide) {
    return null;
  }

  function runAction(action: "request" | "approve" | "reject") {
    startTransition(() => {
      void (async () => {
        try {
          if (action === "request") {
            for (const reason of requestableReasons) {
              await postApprovalAction(versionId, {
                action: "request",
                rule_id: reason.ruleId,
              });
            }

            toast.success({
              title: "Demande envoyee",
              description: "La version est maintenant en revue d'approbation.",
            });
          } else {
            for (const reason of pendingReasons) {
              await postApprovalAction(versionId, {
                action,
                approval_id: reason.approvalId!,
              });
            }

            toast.success({
              title: action === "approve" ? "Version approuvee" : "Corrections demandees",
              description:
                action === "approve"
                  ? "Toutes les demandes en attente ont ete validees."
                  : "Les demandes en attente ont ete marquees a reprendre.",
            });
          }

          router.refresh();
        } catch (error) {
          toast.error({
            title: "Action impossible",
            description:
              error instanceof Error
                ? error.message
                : "Impossible de mettre a jour l'approbation.",
          });
        }
      })();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canRequest ? (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={isPending}
          onClick={() => runAction("request")}
        >
          {isPending ? "En cours..." : "Demander approbation"}
        </button>
      ) : null}

      {canDecide ? (
        <>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={isPending}
            onClick={() => runAction("approve")}
          >
            {isPending ? "En cours..." : "Approuver"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isPending}
            onClick={() => runAction("reject")}
          >
            {isPending ? "En cours..." : "Demander modifications"}
          </button>
        </>
      ) : null}
    </div>
  );
}
