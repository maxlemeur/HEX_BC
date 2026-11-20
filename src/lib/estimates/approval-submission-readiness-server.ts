import type { Supabase, RulesEngineVersion, RulesEngineProject, RulesEngineItemAccess, EvaluateRulesResult, EstimateApprovalSubmissionSignal } from "@/lib/estimates/approval-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAffaireRegisterHubHref } from "@/lib/affaires/register";
import { buildAffaireRegisterSubmissionSignalMessage, fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import type { V3MarginEvidence } from "@/lib/estimates/v3-margin-evidence-server";
import type { CanonicalFixedDiscountEvidence } from "@/lib/estimates/effective-discount";
import type { EstimateReadinessCategory } from "@/lib/estimates/readiness";
import { fetchVersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";
import { isEstimateAiDraftEnabled } from "@/lib/estimates/ai-draft-availability";
import type { Database } from "@/types/database";
import { isApprovalWorkflowSignal, resolveApprovalSummaryLabel } from "@/lib/estimates/rule-evaluation";
import { evaluateRules } from "@/lib/estimates/rule-evaluation-server";

function toSubmissionReadinessSignal(input: {
  id: string;
  label: string;
  message: string;
  category?: EstimateReadinessCategory;
  actionLabel?: string;
  actionHref?: string;
}): EstimateApprovalSubmissionSignal {
  return {
    id: input.id,
    label: input.label,
    message: input.message,
    category: input.category,
    actionLabel: input.actionLabel,
    actionHref: input.actionHref,
  };
}

function dedupeSubmissionSignals(
  signals: EstimateApprovalSubmissionSignal[]
) {
  return [...new Map(signals.map((signal) => [signal.id, signal])).values()];
}

export function buildSubmissionReadinessFromRulesEvaluation(input: {
  rulesEvaluation: EvaluateRulesResult;
}): {
  blockers: EstimateApprovalSubmissionSignal[];
  alerts: EstimateApprovalSubmissionSignal[];
} {
  const blockers = [
    ...input.rulesEvaluation.blockingViolations
      .filter(
        (violation) =>
          !isApprovalWorkflowSignal({
            action: violation.action,
            ruleType: violation.rule_type,
          })
      )
      .map((violation) =>
        toSubmissionReadinessSignal({
          id: `rule:${violation.rule_id}`,
          label: resolveApprovalSummaryLabel(violation.rule_type),
          message: violation.message,
          category: "approvals",
        })
      ),
    ...input.rulesEvaluation.unavailableSignals
      .filter((signal) => signal.action === "block")
      .map((signal) =>
        toSubmissionReadinessSignal({
          id: `signal:${signal.rule_id}`,
          label: resolveApprovalSummaryLabel(signal.rule_type),
          message: signal.message,
          category: "approvals",
        })
      ),
  ];

  const alerts = [
    ...input.rulesEvaluation.warningViolations.map((violation) =>
      toSubmissionReadinessSignal({
        id: `rule:${violation.rule_id}`,
        label: resolveApprovalSummaryLabel(violation.rule_type),
        message: violation.message,
        category: "approvals",
      })
    ),
    ...input.rulesEvaluation.unavailableSignals
      .filter((signal) => signal.action !== "block")
      .map((signal) =>
        toSubmissionReadinessSignal({
          id: `signal:${signal.rule_id}`,
          label: resolveApprovalSummaryLabel(signal.rule_type),
          message: signal.message,
          category: "approvals",
        })
      ),
  ];

  return {
    blockers: dedupeSubmissionSignals(blockers),
    alerts: dedupeSubmissionSignals(alerts),
  };
}

export async function loadSubmissionReadinessRegisterContext(input: {
  supabase: SupabaseClient<Database> | Supabase;
  projectId: string;
  versionId: string;
}) {
  const [registerSummary, versionZeroSummary] = await Promise.all([
    fetchAffaireRegisterGateSummary({
      supabase: input.supabase,
      projectId: input.projectId,
      versionId: input.versionId,
    }),
    fetchVersionZeroDraftSummary({ versionId: input.versionId }).catch(() => null),
  ]);
  return { registerSummary, versionZeroSummary };
}

async function enrichSubmissionReadinessWithAffaireRegister(input: {
  supabase: SupabaseClient<Database> | Supabase;
  projectId: string;
  versionId: string;
  submissionReadiness: {
    blockers: EstimateApprovalSubmissionSignal[];
    alerts: EstimateApprovalSubmissionSignal[];
  };
}) {
  return applySubmissionReadinessRegisterContext({
    ...input,
    ...(await loadSubmissionReadinessRegisterContext(input)),
  });
}

export function applySubmissionReadinessRegisterContext(input: {
  projectId: string;
  versionId: string;
  submissionReadiness: {
    blockers: EstimateApprovalSubmissionSignal[];
    alerts: EstimateApprovalSubmissionSignal[];
  };
} & Awaited<ReturnType<typeof loadSubmissionReadinessRegisterContext>>) {
  const { registerSummary, versionZeroSummary } = input;
  const blockers = [...input.submissionReadiness.blockers];
  const alerts = [...input.submissionReadiness.alerts];
  const criticalMissingPieceEntries = registerSummary.criticalOpenEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const criticalAssumptionEntries = registerSummary.criticalOpenEntries.filter(
    (entry) => entry.kind === "assumption"
  );
  const openMissingPieceEntries = registerSummary.nonCriticalOpenEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const openAssumptionEntries = registerSummary.nonCriticalOpenEntries.filter(
    (entry) => entry.kind === "assumption"
  );
  const clarifyMissingPieceEntries = registerSummary.clarifyWithClientEntries.filter(
    (entry) => entry.kind === "missing_piece"
  );
  const clarifyAssumptionEntries = registerSummary.clarifyWithClientEntries.filter(
    (entry) => entry.kind === "assumption"
  );

  if (criticalMissingPieceEntries.length > 0) {
    blockers.push(
      toSubmissionReadinessSignal({
        id: "register:critical_missing_pieces",
        label: "Documents",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: criticalMissingPieceEntries,
          label: "Documents critiques manquants",
          intro: "Des pièces critiques restent manquantes avant soumission.",
        }),
        category: "documents",
        actionLabel: "Ouvrir les documents manquants",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          severity: "critical",
          kind: "missing_piece",
          focusEntryId: criticalMissingPieceEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (criticalAssumptionEntries.length > 0) {
    blockers.push(
      toSubmissionReadinessSignal({
        id: "register:critical_open_questions",
        label: "Registre affaire",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: criticalAssumptionEntries,
          label: "Questions critiques ouvertes",
          intro: "Des questions critiques restent ouvertes.",
        }),
        category: "register",
        actionLabel: "Ouvrir le registre",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          severity: "critical",
          kind: "assumption",
          focusEntryId: criticalAssumptionEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (openMissingPieceEntries.length > 0) {
    alerts.push(
      toSubmissionReadinessSignal({
        id: "register:missing_pieces_pending",
        label: "Documents",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: openMissingPieceEntries,
          label: "Documents manquants",
          intro: "Des pièces manquantes restent ouvertes avant validation.",
        }),
        category: "documents",
        actionLabel: "Ouvrir les documents manquants",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          kind: "missing_piece",
          focusEntryId: openMissingPieceEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (openAssumptionEntries.length > 0) {
    alerts.push(
      toSubmissionReadinessSignal({
        id: "register:open_questions_pending",
        label: "Registre affaire",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: openAssumptionEntries,
          label: "Questions ouvertes",
          intro: "Des hypothèses restent ouvertes avant validation.",
        }),
        category: "register",
        actionLabel: "Ouvrir le registre",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "open",
          kind: "assumption",
          focusEntryId: openAssumptionEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (clarifyMissingPieceEntries.length > 0) {
    alerts.push(
      toSubmissionReadinessSignal({
        id: "register:client_missing_documents_required",
        label: "Documents",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: clarifyMissingPieceEntries,
          label: "Documents attendus du client",
          intro: "Des pièces restent à demander au client avant envoi externe.",
        }),
        category: "documents",
        actionLabel: "Ouvrir les documents attendus",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "clarify_with_client",
          kind: "missing_piece",
          focusEntryId: clarifyMissingPieceEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (clarifyAssumptionEntries.length > 0) {
    alerts.push(
      toSubmissionReadinessSignal({
        id: "register:client_clarification_required",
        label: "Registre affaire",
        message: buildAffaireRegisterSubmissionSignalMessage({
          entries: clarifyAssumptionEntries,
          label: "Clarifications client",
          intro:
            "Des points restent à clarifier avec le client avant envoi externe.",
        }),
        category: "register",
        actionLabel: "Ouvrir le registre",
        actionHref: buildAffaireRegisterHubHref({
          projectId: input.projectId,
          status: "clarify_with_client",
          kind: "assumption",
          focusEntryId: clarifyAssumptionEntries[0]?.id ?? null,
        }),
      })
    );
  }

  if (versionZeroSummary?.activeDraft) {
    blockers.push(
      toSubmissionReadinessSignal({
        id: "version-zero:review_pending",
        label: "V0 IA",
        message:
          versionZeroSummary.activeDraft.counts.pending > 0
            ? `La V0 IA comporte encore ${versionZeroSummary.activeDraft.counts.pending} ligne(s) en attente de validation humaine.`
            : "Une V0 IA active doit être matérialisée ou abandonnée avant soumission.",
        category: "estimate_quality",
        actionLabel: isEstimateAiDraftEnabled() ? "Ouvrir la V0" : undefined,
        actionHref: isEstimateAiDraftEnabled()
          ? `/dashboard/estimates/${input.versionId}/edit?openVersionZero=1`
          : undefined,
      })
    );
  }

  return {
    blockers: dedupeSubmissionSignals(blockers),
    alerts: dedupeSubmissionSignals(alerts),
  };
}

export async function evaluateSubmissionReadiness(input: {
  supabase: SupabaseClient<Database> | Supabase;
  tenantId: string;
  version: RulesEngineVersion;
  project: RulesEngineProject;
  items: RulesEngineItemAccess[];
  fixedDiscountEvidence?: CanonicalFixedDiscountEvidence | null;
  v3MarginEvidence?: V3MarginEvidence | null;
}) {
  const rulesEvaluation = await evaluateRules({
    supabase: input.supabase,
    tenantId: input.tenantId,
    version: input.version,
    project: input.project,
    items: input.items,
    preserveApprovedRequiresApproval: true,
    fixedDiscountEvidence: input.fixedDiscountEvidence,
    v3MarginEvidence: input.v3MarginEvidence,
  });

  return enrichSubmissionReadinessWithAffaireRegister({
    supabase: input.supabase,
    projectId: input.project.id,
    versionId: input.version.id,
    submissionReadiness: buildSubmissionReadinessFromRulesEvaluation({
      rulesEvaluation,
    }),
  });
}
