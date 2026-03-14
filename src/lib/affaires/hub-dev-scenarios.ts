import {
  createEmptyAffaireIntakeExtractedMetadata,
  type AffaireIntakeBriefDraft,
  type AffaireIntakeDocumentPriority,
  isAffaireIntakePrimaryEligibleKind,
} from "@/lib/affaires/intake";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { AffaireRegisterSummary } from "@/lib/affaires/register";
import type {
  AffaireHubFinishLineSummaryResult,
  AffaireHubPlansSummaryResult,
  AffaireHubSummaryResult,
} from "@/lib/affaires/server";
import { buildAffaireHubReadinessSnapshot } from "@/lib/affaires/server";
import type { EstimateApprovalSummary } from "@/lib/estimates/rules-engine";
import type { TakeoffVisibleJobStatus } from "@/lib/takeoff/visible-status";
import type { VersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";

export const AFFAIRE_HUB_DEV_SCENARIOS = [
  "review",
  "review-and-missing",
  "cctp-confirmed-review-dpgf-missing",
  "dpgf-confirmed-review-plans-missing",
  "plans-confirmed-review-dpgf-missing",
  "dpgf-primary-plus-secondary-review-dpgf",
  "multiple-dpgf-no-primary",
  "multiple-cctp-no-primary",
  "validated-review-missing-multi",
  "crowded-review-missing",
  "dpgf-only",
  "plans-only",
  "cctp-only",
  "complete-brief",
  "brief-confirmed",
  "plans-ready",
] as const;

export type AffaireHubDevScenario = (typeof AFFAIRE_HUB_DEV_SCENARIOS)[number];

type ApplyAffaireHubDevScenarioInput = {
  scenario: AffaireHubDevScenario;
  projectId: string;
  summary: AffaireHubSummaryResult;
};

type AffaireHubDevScenarioOverrides = {
  summary: AffaireHubSummaryResult;
  intakeWorkspace: AffaireIntakeWorkspace;
  plansSummary: AffaireHubPlansSummaryResult | null;
  versionZeroSummary: VersionZeroDraftSummary | null;
  registerSummary: AffaireRegisterSummary | null;
  approvalSummary: EstimateApprovalSummary | null;
  finishLineSummary: AffaireHubFinishLineSummaryResult | null;
};

const FIXED_NOW_ISO = "2026-03-11T09:00:00.000Z";
const DEV_UPLOAD_ID = "11111111-1111-4111-8111-111111111111";

function createRegisterSummary(input?: Partial<AffaireRegisterSummary>): AffaireRegisterSummary {
  return {
    openQuestionsCount: input?.openQuestionsCount ?? 0,
    criticalOpenCount: input?.criticalOpenCount ?? 0,
    nonCriticalOpenCount: input?.nonCriticalOpenCount ?? 0,
    clarifyWithClientCount: input?.clarifyWithClientCount ?? 0,
    openAssumptionCount: input?.openAssumptionCount ?? 0,
    openMissingPieceCount: input?.openMissingPieceCount ?? 0,
  };
}

function createDocument(input: {
  documentId: string;
  fileName: string;
  detectedCategory: AffaireIntakeWorkspace["documents"][number]["detectedCategory"];
  confidence: number;
  issues?: string[];
  detectedLots?: string[];
  documentPriority?: AffaireIntakeDocumentPriority | null;
}) {
  return {
    documentId: input.documentId,
    fileName: input.fileName,
    detectedCategory: input.detectedCategory,
    documentPriority:
      input.documentPriority ??
      (isAffaireIntakePrimaryEligibleKind(input.detectedCategory)
        ? "primary"
        : "secondary"),
    confidence: input.confidence,
    extractedMetadata: {
      ...createEmptyAffaireIntakeExtractedMetadata(),
      detectedLots: input.detectedLots ?? [],
    },
    issues: input.issues ?? [],
  };
}

function createBriefDraft(
  status: AffaireIntakeBriefDraft["status"],
): AffaireIntakeBriefDraft {
  return {
    status,
    summary: "Consultation tertiaire avec pieces critiques recues.",
    projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
    scope: ["Courants forts", "Courants faibles"],
    lots: ["Electricite", "SSI"],
    receivedPieces: ["DPGF", "Plans", "CCTP"],
    assumptions: ["Prix fournisseurs a confirmer apres premiere passe."],
    vigilancePoints: ["Verifier les variantes mentionnees dans le CCTP."],
    missingElements: [],
    sources: [],
    uploadId: DEV_UPLOAD_ID,
    lastGeneratedAt: FIXED_NOW_ISO,
    confirmedAt: status === "confirme" ? FIXED_NOW_ISO : null,
  };
}

function ensureCurrentVersion(
  summary: AffaireHubSummaryResult,
  projectId: string,
): AffaireHubSummaryResult {
  if (summary.currentVersion) {
    return {
      ...summary,
      lineCount: 0,
    };
  }

  return {
    ...summary,
    currentVersion: {
      id: "22222222-2222-4222-8222-222222222222",
      projectId,
      versionNumber: 1,
      status: "draft",
      totalHtCents: 0,
      marginMultiplier: 1,
      marginPercent: 0,
      updatedAt: FIXED_NOW_ISO,
    },
    versionsCount: Math.max(summary.versionsCount, 1),
    lineCount: 0,
  };
}

function createVersionZeroSummary(input: {
  projectId: string;
  versionId: string;
  hasActiveDraft?: boolean;
}): VersionZeroDraftSummary {
  return {
    versionId: input.versionId,
    projectId: input.projectId,
    hasConfirmedBrief: true,
    confirmedBriefId: "33333333-3333-4333-8333-333333333333",
    isVersionEmpty: true,
    canGenerate: true,
    availableLots: ["Electricite", "SSI"],
    activeDraft: input.hasActiveDraft
      ? {
          id: "44444444-4444-4444-8444-444444444444",
          status: "ia_a_revoir",
          createdAt: FIXED_NOW_ISO,
          materializedAt: null,
          selectedLots: ["Electricite"],
          counts: {
            lots: 2,
            lines: 14,
            pending: 4,
            accepted: 6,
            edited: 2,
            rejected: 2,
            missingLots: 0,
            partialLots: 1,
            lowConfidenceLines: 3,
          },
          summaryText: "Brouillon V0 genere pour accelerer la structuration.",
          state: "active",
        }
      : null,
  };
}

function createPlansSummary(input: {
  versionId: string;
  latestJobStatus?: TakeoffVisibleJobStatus | null;
}): AffaireHubPlansSummaryResult {
  return {
    planSetCount: 1,
    planFileCount: 3,
    totalSizeBytes: 18_400_000,
    hasLegacyFallback: false,
    defaultPlanSetId: "55555555-5555-4555-8555-555555555555",
    defaultPlanSetName: "Plans intake confirmes",
    defaultPlanSetSource: "affaire-intake",
    defaultPlanSetFileCount: 3,
    defaultPlanSetUpdatedAt: FIXED_NOW_ISO,
    launchRecommendation: null,
    defaultPlanSetLatestJob: input.latestJobStatus
      ? {
          status: input.latestJobStatus,
          planSetId: "55555555-5555-4555-8555-555555555555",
          estimateVersionId: input.versionId,
          createdAt: FIXED_NOW_ISO,
        }
      : null,
    latestJob: input.latestJobStatus
      ? {
          jobId: "66666666-6666-4666-8666-666666666666",
          status: input.latestJobStatus,
          label: "Revue requise",
          reviewVersionId: input.versionId,
          planSetId: "55555555-5555-4555-8555-555555555555",
          estimateVersionId: input.versionId,
          createdAt: FIXED_NOW_ISO,
        }
      : null,
    coveragePercent: null,
    exceptionCount: null,
    openQuestionsCount: 0,
    failureReasonLabel: null,
  };
}

function withScenarioHubReadiness(
  summary: AffaireHubSummaryResult,
  intakeWorkspace: AffaireIntakeWorkspace,
  registerSummary: AffaireRegisterSummary | null,
): AffaireHubSummaryResult {
  const createEntries = (count: number) =>
    Array.from({ length: count }, () => ({}));

  return {
    ...summary,
    hubReadiness: buildAffaireHubReadinessSnapshot({
      lineCount: summary.lineCount,
      briefStatus:
        intakeWorkspace.briefDraft?.status === "a_confirmer" ||
        intakeWorkspace.briefDraft?.status === "confirme"
          ? intakeWorkspace.briefDraft.status
          : null,
      intakeReadiness: {
        reviewDocumentsCount: intakeWorkspace.documents.filter(
          (document) =>
            document.detectedCategory === "a_classer" ||
            document.issues.length > 0 ||
            document.confidence < 0.9,
        ).length,
        confirmedMissingPiecesCount: intakeWorkspace.missingPieces.length,
        confirmedCriticalMissingPiecesCount: intakeWorkspace.missingPieces.filter(
          (piece) => piece.severity === "critical",
        ).length,
      },
      registerGateSummary: registerSummary
        ? {
            criticalOpenEntries: createEntries(registerSummary.criticalOpenCount),
            clarifyWithClientEntries: createEntries(
              registerSummary.clarifyWithClientCount,
            ),
            continuedWithHypothesisEntries: createEntries(
              registerSummary.openAssumptionCount,
            ),
            revalidationRequiredEntries: [],
            criticalRevalidationRequiredEntries: [],
          }
        : null,
    }),
  };
}

export function parseAffaireHubDevScenario(
  value: string | string[] | undefined,
): AffaireHubDevScenario | null {
  if (typeof value !== "string") {
    return null;
  }

  return AFFAIRE_HUB_DEV_SCENARIOS.includes(value as AffaireHubDevScenario)
    ? (value as AffaireHubDevScenario)
    : null;
}

export function applyAffaireHubDevScenario(
  input: ApplyAffaireHubDevScenarioInput,
): AffaireHubDevScenarioOverrides {
  const summary = ensureCurrentVersion(input.summary, input.projectId);
  const versionId = summary.currentVersion?.id ?? "22222222-2222-4222-8222-222222222222";

  if (input.scenario === "review") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "77777777-7777-4777-8777-777777777777",
            fileName: "piece-inconnue.pdf",
            detectedCategory: "a_classer",
            confidence: 0.42,
            issues: ["Classification a confirmer"],
          }),
        ],
        missingPieces: [],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "review-and-missing") {
    const intakeWorkspace: AffaireIntakeWorkspace = {
      projectId: input.projectId,
      uploadId: DEV_UPLOAD_ID,
      documents: [
        createDocument({
          documentId: "78787878-7878-4787-8787-787878787878",
          fileName: "piece-inconnue.pdf",
          detectedCategory: "a_classer",
          confidence: 0.42,
          issues: ["Classification a confirmer"],
        }),
      ],
      missingPieces: [
        { code: "missing_dpgf", label: "DPGF manquant", severity: "critical" },
        { code: "missing_plans", label: "Plans manquants", severity: "critical" },
        { code: "missing_cctp", label: "CCTP manquant", severity: "warning" },
      ],
      briefDraft: null,
    };

    return {
      summary: withScenarioHubReadiness(summary, intakeWorkspace, null),
      intakeWorkspace,
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "cctp-confirmed-review-dpgf-missing") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "13131313-1313-4313-8313-131313131313",
            fileName: "cctp-lot-electricite.docx",
            detectedCategory: "cctp",
            confidence: 0.97,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "14141414-1414-4414-8414-141414141414",
            fileName: "piece-inconnue.pdf",
            detectedCategory: "a_classer",
            confidence: 0.42,
            issues: ["Classification a confirmer"],
          }),
        ],
        missingPieces: [
          { code: "missing_dpgf", label: "DPGF manquant", severity: "critical" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "dpgf-confirmed-review-plans-missing") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "15151515-1515-4515-8515-151515151515",
            fileName: "dpgf-electricite.xlsx",
            detectedCategory: "dpgf",
            confidence: 0.98,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "16161616-1616-4616-8616-161616161616",
            fileName: "piece-inconnue.pdf",
            detectedCategory: "a_classer",
            confidence: 0.42,
            issues: ["Classification a confirmer"],
          }),
        ],
        missingPieces: [
          { code: "missing_plans", label: "Plans manquants", severity: "critical" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "dpgf-primary-plus-secondary-review-dpgf") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "19191919-1919-4919-8919-191919191919",
            fileName: "dpgf-lot-a.xlsx",
            detectedCategory: "dpgf",
            documentPriority: "primary",
            confidence: 0.99,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "20202020-2020-4020-8020-202020202020",
            fileName: "piece-inconnue.xlsx",
            detectedCategory: "a_classer",
            documentPriority: "secondary",
            confidence: 0.44,
            issues: ["Classification a confirmer"],
          }),
          createDocument({
            documentId: "21212121-2121-4121-8121-212121212121",
            fileName: "dpgf-variante-b.xlsx",
            detectedCategory: "dpgf",
            documentPriority: "secondary",
            confidence: 0.95,
            detectedLots: ["Electricite"],
          }),
        ],
        missingPieces: [
          { code: "missing_plans", label: "Plans manquants", severity: "critical" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "multiple-dpgf-no-primary") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "22222222-2222-4222-8222-222222222221",
            fileName: "dpgf-lot-a.xlsx",
            detectedCategory: "dpgf",
            documentPriority: "secondary",
            confidence: 0.99,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "22222222-2222-4222-8222-222222222223",
            fileName: "dpgf-lot-b.xlsx",
            detectedCategory: "dpgf",
            documentPriority: "secondary",
            confidence: 0.97,
            detectedLots: ["SSI"],
          }),
        ],
        missingPieces: [{ code: "missing_plans", label: "Plans manquants", severity: "critical" }],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "multiple-cctp-no-primary") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "23232323-2323-4232-8232-232323232323",
            fileName: "cctp-lot-a.docx",
            detectedCategory: "cctp",
            documentPriority: "secondary",
            confidence: 0.99,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "24242424-2424-4242-8242-242424242424",
            fileName: "cctp-lot-b.docx",
            detectedCategory: "cctp",
            documentPriority: "secondary",
            confidence: 0.96,
            detectedLots: ["SSI"],
          }),
        ],
        missingPieces: [{ code: "missing_dpgf", label: "DPGF manquant", severity: "critical" }],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "validated-review-missing-multi") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "25252525-2525-4252-8252-252525252525",
            fileName: "dpgf-principal.xlsx",
            detectedCategory: "dpgf",
            documentPriority: "primary",
            confidence: 0.99,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "26262626-2626-4262-8262-262626262626",
            fileName: "piece-inconnue-1.pdf",
            detectedCategory: "a_classer",
            confidence: 0.41,
            issues: ["Classification a confirmer"],
          }),
          createDocument({
            documentId: "27272727-2727-4272-8272-272727272727",
            fileName: "piece-inconnue-2.docx",
            detectedCategory: "a_classer",
            confidence: 0.48,
            issues: ["Classification a confirmer"],
          }),
          createDocument({
            documentId: "28282828-2828-4282-8282-282828282828",
            fileName: "cctp-variante.docx",
            detectedCategory: "cctp",
            documentPriority: "secondary",
            confidence: 0.94,
            detectedLots: ["Electricite"],
          }),
        ],
        missingPieces: [
          { code: "missing_plans", label: "Plans manquants", severity: "critical" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "crowded-review-missing") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "29292929-2929-4292-8292-292929292929",
            fileName: "dpgf-principal.xlsx",
            detectedCategory: "dpgf",
            documentPriority: "primary",
            confidence: 0.99,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "30303030-3030-4030-8030-303030303030",
            fileName: "cctp-principal.docx",
            detectedCategory: "cctp",
            documentPriority: "primary",
            confidence: 0.98,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "31313131-3131-4131-8131-313131313131",
            fileName: "bpu-electricite.xlsx",
            detectedCategory: "bpu_dqe",
            confidence: 0.96,
          }),
          createDocument({
            documentId: "32323232-3232-4232-8232-323232323232",
            fileName: "annexe-variantes.pdf",
            detectedCategory: "annexes",
            confidence: 0.94,
          }),
          createDocument({
            documentId: "33333333-3333-4333-8333-333333333334",
            fileName: "courrier-client.eml",
            detectedCategory: "emails",
            confidence: 0.92,
          }),
          createDocument({
            documentId: "34343434-3434-4334-8334-343434343434",
            fileName: "piece-inconnue-1.pdf",
            detectedCategory: "a_classer",
            confidence: 0.39,
            issues: ["Classification a confirmer"],
          }),
          createDocument({
            documentId: "35353535-3535-4353-8353-353535353535",
            fileName: "piece-inconnue-2.docx",
            detectedCategory: "a_classer",
            confidence: 0.45,
            issues: ["Classification a confirmer"],
          }),
          createDocument({
            documentId: "36363636-3636-4363-8363-363636363636",
            fileName: "piece-inconnue-3.png",
            detectedCategory: "a_classer",
            confidence: 0.52,
            issues: ["Classification a confirmer"],
          }),
        ],
        missingPieces: [
          { code: "missing_plans", label: "Plans manquants", severity: "critical" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "plans-confirmed-review-dpgf-missing") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "17171717-1717-4717-8717-171717171717",
            fileName: "plans-rdc.pdf",
            detectedCategory: "plans",
            confidence: 0.99,
            detectedLots: ["Electricite"],
          }),
          createDocument({
            documentId: "18181818-1818-4818-8818-181818181818",
            fileName: "piece-inconnue.pdf",
            detectedCategory: "a_classer",
            confidence: 0.42,
            issues: ["Classification a confirmer"],
          }),
        ],
        missingPieces: [
          { code: "missing_dpgf", label: "DPGF manquant", severity: "critical" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "dpgf-only") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "88888888-8888-4888-8888-888888888888",
            fileName: "dpgf-electricite.xlsx",
            detectedCategory: "dpgf",
            confidence: 0.98,
            detectedLots: ["Electricite"],
          }),
        ],
        missingPieces: [
          { code: "missing_plans", label: "Plans manquants", severity: "critical" },
          { code: "missing_cctp", label: "CCTP manquant", severity: "warning" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "plans-only") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "99999999-9999-4999-8999-999999999999",
            fileName: "plans-rdc.pdf",
            detectedCategory: "plans",
            confidence: 0.99,
            detectedLots: ["Electricite"],
          }),
        ],
        missingPieces: [
          { code: "missing_dpgf", label: "DPGF manquant", severity: "critical" },
          { code: "missing_cctp", label: "CCTP manquant", severity: "warning" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "cctp-only") {
    return {
      summary,
      intakeWorkspace: {
        projectId: input.projectId,
        uploadId: DEV_UPLOAD_ID,
        documents: [
          createDocument({
            documentId: "12121212-1212-4212-8212-121212121212",
            fileName: "cctp-lot-electricite.docx",
            detectedCategory: "cctp",
            confidence: 0.96,
            detectedLots: ["Electricite"],
          }),
        ],
        missingPieces: [
          { code: "missing_dpgf", label: "DPGF manquant", severity: "critical" },
          { code: "missing_plans", label: "Plans manquants", severity: "critical" },
        ],
        briefDraft: null,
      },
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "complete-brief") {
    const intakeWorkspace: AffaireIntakeWorkspace = {
      projectId: input.projectId,
      uploadId: DEV_UPLOAD_ID,
      documents: [
        createDocument({
          documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          fileName: "dpgf-electricite.xlsx",
          detectedCategory: "dpgf",
          confidence: 0.99,
          detectedLots: ["Electricite"],
        }),
        createDocument({
          documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          fileName: "plans-rdc.pdf",
          detectedCategory: "plans",
          confidence: 0.99,
          detectedLots: ["Electricite"],
        }),
        createDocument({
          documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          fileName: "cctp-lot-electricite.docx",
          detectedCategory: "cctp",
          confidence: 0.94,
          detectedLots: ["Electricite"],
        }),
      ],
      missingPieces: [],
      briefDraft: createBriefDraft("a_confirmer"),
    };

    return {
      summary: withScenarioHubReadiness(summary, intakeWorkspace, null),
      intakeWorkspace,
      plansSummary: null,
      versionZeroSummary: null,
      registerSummary: null,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  if (input.scenario === "brief-confirmed") {
    const intakeWorkspace: AffaireIntakeWorkspace = {
      projectId: input.projectId,
      uploadId: DEV_UPLOAD_ID,
      documents: [
        createDocument({
          documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          fileName: "dpgf-electricite.xlsx",
          detectedCategory: "dpgf",
          confidence: 0.99,
          detectedLots: ["Electricite"],
        }),
        createDocument({
          documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          fileName: "plans-rdc.pdf",
          detectedCategory: "plans",
          confidence: 0.99,
          detectedLots: ["Electricite"],
        }),
        createDocument({
          documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          fileName: "cctp-lot-electricite.docx",
          detectedCategory: "cctp",
          confidence: 0.94,
          detectedLots: ["Electricite"],
        }),
      ],
      missingPieces: [],
      briefDraft: createBriefDraft("confirme"),
    };
    const registerSummary = createRegisterSummary({
      openQuestionsCount: 2,
      criticalOpenCount: 2,
      nonCriticalOpenCount: 2,
      openMissingPieceCount: 4,
    });

    return {
      summary: withScenarioHubReadiness(summary, intakeWorkspace, registerSummary),
      intakeWorkspace,
      plansSummary: null,
      versionZeroSummary: createVersionZeroSummary({
        projectId: input.projectId,
        versionId,
      }),
      registerSummary,
      approvalSummary: null,
      finishLineSummary: null,
    };
  }

  return {
    summary,
    intakeWorkspace: {
      projectId: input.projectId,
      uploadId: DEV_UPLOAD_ID,
      documents: [
        createDocument({
          documentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          fileName: "dpgf-electricite.xlsx",
          detectedCategory: "dpgf",
          confidence: 0.99,
          detectedLots: ["Electricite"],
        }),
        createDocument({
          documentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          fileName: "plans-rdc.pdf",
          detectedCategory: "plans",
          confidence: 0.99,
          detectedLots: ["Electricite"],
        }),
        createDocument({
          documentId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          fileName: "cctp-lot-electricite.docx",
          detectedCategory: "cctp",
          confidence: 0.94,
          detectedLots: ["Electricite"],
        }),
      ],
      missingPieces: [],
      briefDraft: createBriefDraft("confirme"),
    },
    plansSummary: createPlansSummary({ versionId, latestJobStatus: null }),
    versionZeroSummary: null,
    registerSummary: null,
    approvalSummary: null,
    finishLineSummary: null,
  };
}
