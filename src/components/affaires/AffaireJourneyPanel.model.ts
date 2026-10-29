import { isAffaireIntakeDocumentNeedingReview, isAffaireIntakeDocumentProcessing } from "@/lib/affaires/intake";
import type { AffaireHubFinishLineSummaryResult } from "@/lib/affaires/server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";
import {
  buildPilotageSteps,
  type AffairePilotageCurrentVersion,
  type AffairePilotageStructureMode,
  type AffairePilotageWorkspace,
} from "./AffairePilotagePanel.logic";
import type { AffaireHubDpgfSourceResult } from "@/lib/affaires/server";

export type JourneyStage = "cadrage" | "etude" | "remise" | "achats";
export type JourneyInput = {
  intakeWorkspace: AffairePilotageWorkspace;
  dpgfSource: AffaireHubDpgfSourceResult;
  plansSummary: AffaireHubPlansSummaryData | null;
  approvalSummary: EstimateApprovalSummary | null;
  currentVersion: AffairePilotageCurrentVersion;
  lineCount: number;
  structureMode?: AffairePilotageStructureMode;
  finishLineSummary?: AffaireHubFinishLineSummaryResult | null;
  takeoffEnabled?: boolean;
  plansError?: string;
  revealPurchases?: boolean;
};

/** Presentation only. Sending, approval and purchase writes keep their server gates. */
export function buildAffaireJourney(input: JourneyInput) {
  const documents = input.intakeWorkspace?.documents ?? [];
  const reviewCount = documents.filter(isAffaireIntakeDocumentNeedingReview).length;
  const processingCount = documents.filter(isAffaireIntakeDocumentProcessing).length;
  const briefConfirmed = input.intakeWorkspace?.briefDraft?.status === "confirme";
  const issued = input.currentVersion?.status === "sending" || input.currentVersion?.status === "sent" || input.currentVersion?.status === "accepted" || input.currentVersion?.status === "archived";
  const accepted = input.currentVersion?.status === "accepted";
  const order = input.finishLineSummary?.readyToOrder;
  // Existing transfers remain discoverable, including on a historical draft.
  const showPurchases = Boolean(input.currentVersion && input.revealPurchases) || (order?.counts?.transferredLines ?? 0) > 0 ||
    (accepted && (order?.counts == null || order.counts.totalSupplierLines > 0));
  const steps = buildPilotageSteps({ ...input, takeoffEnabled: input.takeoffEnabled ?? false });
  const structureReady = input.lineCount > 0 && input.structureMode?.mode !== "needs_update" &&
    (input.structureMode?.unsupportedLineCount ?? 0) === 0;
  const takeoffNeedsWork = Boolean(input.plansError) || steps.find((step) => step.key === "metre")?.status === "blocked" ||
    ["queued", "processing", "provider_pending"].includes(input.plansSummary?.latestJob?.status ?? "");
  // Legacy estimates with no intake do not acquire an artificial brief requirement.
  const linkedDpgfReady = input.dpgfSource?.importStatus === "completed" &&
    [null, "validated", "applied"].includes(input.dpgfSource.mappingStatus);
  const cadrageReady = input.intakeWorkspace !== null && (documents.length === 0
    ? input.lineCount > 0 || linkedDpgfReady || (input.plansSummary?.planFileCount ?? 0) > 0
    : reviewCount === 0 && processingCount === 0 && briefConfirmed);
  const canShowOutput = issued || (cadrageReady && structureReady && !takeoffNeedsWork);
  const current: JourneyStage = showPurchases && accepted ? "achats"
    : issued ? "remise" : !cadrageReady ? "cadrage" : !canShowOutput ? "etude" : "remise";
  const stages = [
    { key: "cadrage" as const, label: "Cadrage", description: "Documents, périmètre et brief" },
    { key: "etude" as const, label: "Étude", description: "Structure, métrés et prix" },
    { key: "remise" as const, label: "Remise", description: "Validation, PDF et email client" },
    ...(showPurchases ? [{ key: "achats" as const, label: "Achats", description: "Brouillons de commandes fournisseurs" }] : []),
  ];
  return { current, stages, reviewCount, processingCount, briefConfirmed, canShowOutput, showPurchases, issued, accepted, steps };
}
