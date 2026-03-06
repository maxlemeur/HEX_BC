import { ESTIMATE_QUALITY_FLAG_META } from "@/lib/estimate-quality";
import type { AffaireIntakeWorkspaceMissingPiece } from "@/lib/affaires/intake";
import type {
  TakeoffDpgfComparisonProof,
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonEvidenceKind,
  TakeoffDpgfLineRiskSummary,
  TakeoffRiskAlert,
  TakeoffRiskCauseCode,
  TakeoffRiskMarginBucket,
  TakeoffRiskProvenanceEntry,
  TakeoffRiskRadarResponse,
  TakeoffRiskRadarScopeSummary,
  TakeoffRiskSeverity,
  TakeoffRiskStatus,
} from "@/lib/takeoff/types";

const RISK_WEIGHT_BY_CAUSE: Record<TakeoffRiskCauseCode, number> = {
  missing_proof: 40,
  dpgf_takeoff_gap: 35,
  atypical_price: 25,
  insufficient_margin: 35,
  vat_inconsistency: 20,
  missing_piece: 30,
};

const RISK_CAUSE_LABELS: Record<TakeoffRiskCauseCode, string> = {
  missing_proof: "Preuve absente",
  dpgf_takeoff_gap: "Ecart DPGF / metre",
  atypical_price: "Prix atypique",
  insufficient_margin: "Marge insuffisante",
  vat_inconsistency: "TVA incoherente",
  missing_piece: "Piece manquante",
};

const ACTIVE_REVIEW_STATUSES: TakeoffRiskStatus[] = [
  "to_process",
  "assumed",
  "false_positive",
];

export type TakeoffRiskCandidate = {
  scope_type: TakeoffRiskAlert["scope_type"];
  scope_ref: string;
  scope_id: string | null;
  scope_label: string;
  line_id: string | null;
  lot_id: string | null;
  cause_code: TakeoffRiskCauseCode;
  severity: TakeoffRiskSeverity;
  risk_score: number;
  margin_bucket: TakeoffRiskMarginBucket;
  reason_labels: string[];
  provenance: TakeoffRiskProvenanceEntry[];
  metadata: Record<string, unknown>;
};

type RiskEstimateItem = {
  id: string;
  parent_id: string | null;
  item_type: string;
  title: string;
  tax_rate_bp: number | null;
};

type BuildTakeoffRiskCandidatesInput = {
  comparisonRows: TakeoffDpgfComparisonRow[];
  estimateItems: RiskEstimateItem[];
  projectId: string;
  projectLabel: string;
  qualityFlagsByItemId: Record<string, string[]>;
  versionTaxRateBp: number | null;
  marginThresholdBp: number | null;
  versionMarginBp: number | null;
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
};

type LotContext = {
  lotId: string | null;
  lotLabel: string;
};

type BuildTakeoffRiskRadarResponseInput = {
  versionId: string;
  jobId: string;
  alerts: TakeoffRiskAlert[];
  projectId: string;
  projectLabel: string;
  lotLabelById: Map<string | null, string>;
  filters?: {
    severity?: TakeoffRiskSeverity | null;
    status?: TakeoffRiskStatus | null;
    scope?: TakeoffRiskAlert["scope_type"] | null;
    lot_id?: string | null;
  };
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatPercentBp(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${(value / 100).toFixed(1)}%`;
}

function deriveSeverity(score: number): TakeoffRiskSeverity {
  if (score >= 70) return "critical";
  if (score >= 35) return "warning";
  return "info";
}

function severityRank(severity: TakeoffRiskSeverity) {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
    default:
      return 1;
  }
}

function statusRank(status: TakeoffRiskStatus) {
  switch (status) {
    case "to_process":
      return 3;
    case "assumed":
      return 2;
    case "false_positive":
    default:
      return 1;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildLotContextByLineId(items: RiskEstimateItem[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const lotByLineId = new Map<string, LotContext>();

  for (const item of items) {
    if (item.item_type !== "line") {
      continue;
    }

    let currentParentId = item.parent_id;
    let resolvedLot: LotContext | null = null;

    while (currentParentId) {
      const parent = itemById.get(currentParentId);
      if (!parent) {
        break;
      }

      if (parent.item_type === "section") {
        resolvedLot = {
          lotId: parent.id,
          lotLabel: parent.title.trim().length > 0 ? parent.title : "Sans lot",
        };
      }

      currentParentId = parent.parent_id;
    }

    lotByLineId.set(
      item.id,
      resolvedLot ?? {
        lotId: null,
        lotLabel: "Sans lot",
      }
    );
  }

  return lotByLineId;
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  const nextValues: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLocaleLowerCase("fr-FR");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    nextValues.push(trimmed);
  }

  return nextValues;
}

function mapProofToProvenance(proof: TakeoffDpgfComparisonProof): TakeoffRiskProvenanceEntry {
  return {
    kind: proof.kind,
    label: proof.label,
    source: proof.source,
    confidence_score: proof.confidence_score,
    note: proof.note,
  };
}

function mergeProvenanceEntries(
  entries: TakeoffRiskProvenanceEntry[]
): TakeoffRiskProvenanceEntry[] {
  const seen = new Set<string>();
  const merged: TakeoffRiskProvenanceEntry[] = [];

  for (const entry of entries) {
    const key = [
      entry.kind,
      entry.label,
      entry.source,
      entry.confidence_score ?? "",
      entry.note ?? "",
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(entry);

    if (merged.length >= 6) {
      break;
    }
  }

  return merged;
}

function buildProofProvenance(
  row: TakeoffDpgfComparisonRow,
  fallback: TakeoffRiskProvenanceEntry
) {
  const proofEntries = row.proofs.map(mapProofToProvenance);
  return mergeProvenanceEntries([...proofEntries, fallback]);
}

function buildInferenceEntry(
  label: string,
  source: string,
  note: string | null,
  confidence_score: number | null = null
): TakeoffRiskProvenanceEntry {
  return {
    kind: "inference",
    label,
    source,
    confidence_score,
    note,
  };
}

function buildFactEntry(
  label: string,
  source: string,
  note: string | null,
  confidence_score: number | null = null
): TakeoffRiskProvenanceEntry {
  return {
    kind: "fact",
    label,
    source,
    confidence_score,
    note,
  };
}

function createCandidate(
  input: Omit<TakeoffRiskCandidate, "risk_score" | "severity"> & {
    cause_code: TakeoffRiskCauseCode;
    score?: number;
  }
): TakeoffRiskCandidate {
  const riskScore = clamp(
    Math.round(input.score ?? RISK_WEIGHT_BY_CAUSE[input.cause_code]),
    0,
    100
  );

  return {
    ...input,
    risk_score: riskScore,
    severity: deriveSeverity(riskScore),
  };
}

function deriveMarginBucket(
  versionMarginBp: number | null,
  marginThresholdBp: number | null
): TakeoffRiskMarginBucket {
  if (versionMarginBp === null || !Number.isFinite(versionMarginBp)) {
    return "unknown";
  }

  if (versionMarginBp < 0) {
    return "negative";
  }

  if (marginThresholdBp !== null && versionMarginBp < marginThresholdBp) {
    return "thin";
  }

  return "healthy";
}

function summarizeLineAlerts(alerts: TakeoffRiskAlert[]): TakeoffDpgfLineRiskSummary | null {
  const lineAlerts = alerts.filter((alert) => alert.line_id !== null);
  if (lineAlerts.length === 0) {
    return null;
  }

  const score = clamp(
    lineAlerts.reduce((sum, alert) => sum + alert.risk_score, 0),
    0,
    100
  );
  const orderedAlerts = [...lineAlerts].sort((left, right) => {
    const statusDiff = statusRank(right.status) - statusRank(left.status);
    if (statusDiff !== 0) {
      return statusDiff;
    }

    const severityDiff = severityRank(right.severity) - severityRank(left.severity);
    if (severityDiff !== 0) {
      return severityDiff;
    }

    return right.risk_score - left.risk_score;
  });

  return {
    score,
    severity: deriveSeverity(score),
    causes: dedupeStrings(
      orderedAlerts.flatMap((alert) => alert.reason_labels.length > 0
        ? alert.reason_labels
        : [alert.cause_label])
    ).slice(0, 3),
    status: orderedAlerts[0]?.status ?? null,
  };
}

export function summarizeTakeoffLineRiskByLineId(alerts: TakeoffRiskAlert[]) {
  const alertsByLineId = new Map<string, TakeoffRiskAlert[]>();

  for (const alert of alerts) {
    if (!alert.line_id) {
      continue;
    }

    const current = alertsByLineId.get(alert.line_id) ?? [];
    current.push(alert);
    alertsByLineId.set(alert.line_id, current);
  }

  return new Map(
    [...alertsByLineId.entries()].map(([lineId, lineAlerts]) => [
      lineId,
      summarizeLineAlerts(lineAlerts),
    ])
  );
}

function rankCauseLabel(alert: TakeoffRiskAlert) {
  return alert.reason_labels[0] ?? alert.cause_label;
}

function buildTopCauseLabels(alerts: TakeoffRiskAlert[]) {
  return dedupeStrings(
    [...alerts]
      .sort((left, right) => {
        const severityDiff = severityRank(right.severity) - severityRank(left.severity);
        if (severityDiff !== 0) {
          return severityDiff;
        }

        return right.risk_score - left.risk_score;
      })
      .map(rankCauseLabel)
  ).slice(0, 3);
}

function buildScopeSummary(
  input: Omit<TakeoffRiskRadarScopeSummary, "score" | "severity" | "open_alerts_count" | "critical_alerts_count" | "top_causes"> & {
    openScores: number[];
    openAlerts: TakeoffRiskAlert[];
  }
): TakeoffRiskRadarScopeSummary {
  const criticalCount = input.openScores.filter((score) => deriveSeverity(score) === "critical").length;
  const maxScore = input.openScores.length > 0 ? Math.max(...input.openScores) : 0;
  const score = clamp(maxScore + Math.max(0, criticalCount - 1) * 5, 0, 100);

  return {
    scope_type: input.scope_type,
    scope_id: input.scope_id,
    scope_label: input.scope_label,
    score,
    severity: deriveSeverity(score),
    open_alerts_count: input.openAlerts.length,
    critical_alerts_count: criticalCount,
    top_causes: buildTopCauseLabels(input.openAlerts),
  };
}

export function buildTakeoffRiskRadarResponse(
  input: BuildTakeoffRiskRadarResponseInput
): TakeoffRiskRadarResponse {
  const activeAlerts = input.alerts.filter((alert) => ACTIVE_REVIEW_STATUSES.includes(alert.status));
  const openAlerts = activeAlerts.filter((alert) => alert.status === "to_process");
  const openLineRiskByLineId = summarizeTakeoffLineRiskByLineId(openAlerts);

  const projectLevelScores = [
    ...openAlerts
      .filter((alert) => alert.scope_type === "project")
      .map((alert) => alert.risk_score),
    ...openLineRiskByLineId.values(),
  ]
    .filter((value): value is number | TakeoffDpgfLineRiskSummary => value !== null)
    .map((value) => (typeof value === "number" ? value : value.score));

  const lotSummariesMap = new Map<string, TakeoffRiskRadarScopeSummary>();
  const openLineAlertsByLotId = new Map<string, TakeoffRiskAlert[]>();
  const openLineRiskScoresByLotId = new Map<string, number[]>();

  for (const alert of openAlerts) {
    if (alert.line_id && alert.lot_id) {
      const currentAlerts = openLineAlertsByLotId.get(alert.lot_id) ?? [];
      currentAlerts.push(alert);
      openLineAlertsByLotId.set(alert.lot_id, currentAlerts);
    }
  }

  for (const [lineId, summary] of openLineRiskByLineId.entries()) {
    if (!summary) {
      continue;
    }

    const sourceAlert = openAlerts.find((alert) => alert.line_id === lineId) ?? null;
    if (!sourceAlert?.lot_id) {
      continue;
    }

    const currentScores = openLineRiskScoresByLotId.get(sourceAlert.lot_id) ?? [];
    currentScores.push(summary.score);
    openLineRiskScoresByLotId.set(sourceAlert.lot_id, currentScores);
  }

  for (const [lotId, lotAlerts] of openLineAlertsByLotId.entries()) {
    lotSummariesMap.set(
      lotId,
      buildScopeSummary({
        scope_type: "lot",
        scope_id: lotId,
        scope_label: input.lotLabelById.get(lotId) ?? "Sans lot",
        openScores: openLineRiskScoresByLotId.get(lotId) ?? [],
        openAlerts: lotAlerts,
      })
    );
  }

  const filteredItems = activeAlerts
    .filter((alert) =>
      input.filters?.severity ? alert.severity === input.filters.severity : true
    )
    .filter((alert) =>
      input.filters?.status ? alert.status === input.filters.status : true
    )
    .filter((alert) =>
      input.filters?.scope ? alert.scope_type === input.filters.scope : true
    )
    .filter((alert) => (input.filters?.lot_id ? alert.lot_id === input.filters.lot_id : true))
    .sort((left, right) => {
      const statusDiff = statusRank(right.status) - statusRank(left.status);
      if (statusDiff !== 0) {
        return statusDiff;
      }

      const severityDiff = severityRank(right.severity) - severityRank(left.severity);
      if (severityDiff !== 0) {
        return severityDiff;
      }

      if (right.risk_score !== left.risk_score) {
        return right.risk_score - left.risk_score;
      }

      return right.updated_at.localeCompare(left.updated_at);
    });

  return {
    version_id: input.versionId,
    job_id: input.jobId,
    summary: {
      to_process_count: activeAlerts.filter((alert) => alert.status === "to_process").length,
      assumed_count: activeAlerts.filter((alert) => alert.status === "assumed").length,
      false_positive_count: activeAlerts.filter((alert) => alert.status === "false_positive").length,
      critical_count: activeAlerts.filter((alert) => alert.severity === "critical").length,
      warning_count: activeAlerts.filter((alert) => alert.severity === "warning").length,
      info_count: activeAlerts.filter((alert) => alert.severity === "info").length,
      top_causes: buildTopCauseLabels(openAlerts),
      project_score: clamp(
        (projectLevelScores.length > 0 ? Math.max(...projectLevelScores) : 0) +
          Math.max(
            0,
            projectLevelScores.filter((score) => deriveSeverity(score) === "critical").length - 1
          ) *
            5,
        0,
        100
      ),
      project_severity: deriveSeverity(
        clamp(
          (projectLevelScores.length > 0 ? Math.max(...projectLevelScores) : 0) +
            Math.max(
              0,
              projectLevelScores.filter((score) => deriveSeverity(score) === "critical").length - 1
            ) *
              5,
          0,
          100
        )
      ),
    },
    project: buildScopeSummary({
      scope_type: "project",
      scope_id: input.projectId,
      scope_label: input.projectLabel,
      openScores: projectLevelScores,
      openAlerts,
    }),
    lots: [...lotSummariesMap.values()].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.scope_label.localeCompare(right.scope_label, "fr-FR");
    }),
    items: filteredItems,
  };
}

export function buildTakeoffRiskCandidates(
  input: BuildTakeoffRiskCandidatesInput
): {
  candidates: TakeoffRiskCandidate[];
  lotLabelById: Map<string | null, string>;
} {
  const lotContextByLineId = buildLotContextByLineId(input.estimateItems);
  const lotLabelById = new Map<string | null, string>([[null, "Sans lot"]]);
  for (const context of lotContextByLineId.values()) {
    lotLabelById.set(context.lotId, context.lotLabel);
  }

  const candidates: TakeoffRiskCandidate[] = [];
  const marginBucket = deriveMarginBucket(input.versionMarginBp, input.marginThresholdBp);

  for (const row of input.comparisonRows) {
    const lotContext = lotContextByLineId.get(row.line_id) ?? {
      lotId: null,
      lotLabel: "Sans lot",
    };
    const activeQualityFlags = input.qualityFlagsByItemId[row.line_id] ?? [];
    const nonDpgfProofs = row.proofs.filter((proof) => proof.type !== "dpgf");

    if (nonDpgfProofs.length === 0) {
      candidates.push(
        createCandidate({
          scope_type: "line",
          scope_ref: row.line_id,
          scope_id: row.line_id,
          scope_label: row.line_label,
          line_id: row.line_id,
          lot_id: lotContext.lotId,
          cause_code: "missing_proof",
          margin_bucket: marginBucket,
          reason_labels: ["Aucune preuve active hors DPGF sur la ligne."],
          provenance: buildProofProvenance(
            row,
            buildInferenceEntry(
              "Couverture de preuves insuffisante",
              "Projection takeoff / preuves",
              "La ligne ne porte actuellement aucune preuve active autre que la source DPGF."
            )
          ),
          metadata: {
            review_status: row.review_status,
            confidence_score: row.confidence_score,
          },
        })
      );
    }

    if (
      row.delta_percent !== null &&
      Number.isFinite(row.delta_percent) &&
      Math.abs(row.delta_percent) > 20
    ) {
      candidates.push(
        createCandidate({
          scope_type: "line",
          scope_ref: row.line_id,
          scope_id: row.line_id,
          scope_label: row.line_label,
          line_id: row.line_id,
          lot_id: lotContext.lotId,
          cause_code: "dpgf_takeoff_gap",
          margin_bucket: marginBucket,
          reason_labels: [
            `Ecart de ${row.delta_percent.toFixed(1)}% entre la quantite DPGF et le metre.`,
          ],
          provenance: buildProofProvenance(
            row,
            buildInferenceEntry(
              "Delta DPGF / metre",
              "Comparaison DPGF / takeoff",
              `DPGF ${row.dpgf_quantity ?? "n/a"} ${row.quantity_unit ?? ""} vs metre ${row.takeoff_quantity ?? "n/a"} ${row.quantity_unit ?? ""}`.trim(),
              row.confidence_score
            )
          ),
          metadata: {
            dpgf_quantity: row.dpgf_quantity,
            takeoff_quantity: row.takeoff_quantity,
            delta_percent: row.delta_percent,
            review_status: row.review_status,
          },
        })
      );
    }

    const pricingFlags = activeQualityFlags.filter((flag) =>
      ["missing_price", "supplier_price_outdated", "price_outlier"].includes(flag)
    );
    if (pricingFlags.length > 0) {
      candidates.push(
        createCandidate({
          scope_type: "line",
          scope_ref: row.line_id,
          scope_id: row.line_id,
          scope_label: row.line_label,
          line_id: row.line_id,
          lot_id: lotContext.lotId,
          cause_code: "atypical_price",
          margin_bucket: marginBucket,
          reason_labels: dedupeStrings(
            pricingFlags.map((flag) => {
              const meta = ESTIMATE_QUALITY_FLAG_META[flag as keyof typeof ESTIMATE_QUALITY_FLAG_META];
              return meta?.label ?? flag;
            })
          ),
          provenance: mergeProvenanceEntries([
            ...row.proofs
              .filter((proof) => proof.type === "price_source")
              .map(mapProofToProvenance),
            buildInferenceEntry(
              "Controle qualite prix",
              "Signaux devis / pricing",
              dedupeStrings(
                pricingFlags.map((flag) => {
                  const meta =
                    ESTIMATE_QUALITY_FLAG_META[flag as keyof typeof ESTIMATE_QUALITY_FLAG_META];
                  return meta?.description ?? flag;
                })
              ).join(" | ")
            ),
          ]),
          metadata: {
            pricing_flags: pricingFlags,
          },
        })
      );
    }

    const estimateItem = input.estimateItems.find((item) => item.id === row.line_id) ?? null;
    const lineTaxRateBp = estimateItem?.tax_rate_bp ?? null;
    if (
      lineTaxRateBp !== null &&
      input.versionTaxRateBp !== null &&
      lineTaxRateBp !== input.versionTaxRateBp
    ) {
      candidates.push(
        createCandidate({
          scope_type: "line",
          scope_ref: row.line_id,
          scope_id: row.line_id,
          scope_label: row.line_label,
          line_id: row.line_id,
          lot_id: lotContext.lotId,
          cause_code: "vat_inconsistency",
          margin_bucket: marginBucket,
          reason_labels: [
            `TVA ligne ${formatPercentBp(lineTaxRateBp)} differente de la TVA version ${formatPercentBp(input.versionTaxRateBp)}.`,
          ],
          provenance: [
            buildFactEntry(
              "TVA de la ligne",
              "Estimate items",
              formatPercentBp(lineTaxRateBp)
            ),
            buildFactEntry(
              "TVA de la version",
              "Estimate version",
              formatPercentBp(input.versionTaxRateBp)
            ),
          ],
          metadata: {
            line_tax_rate_bp: lineTaxRateBp,
            version_tax_rate_bp: input.versionTaxRateBp,
          },
        })
      );
    }
  }

  if (
    input.versionMarginBp !== null &&
    input.marginThresholdBp !== null &&
    input.versionMarginBp < input.marginThresholdBp
  ) {
    candidates.push(
      createCandidate({
        scope_type: "project",
        scope_ref: input.projectId,
        scope_id: input.projectId,
        scope_label: input.projectLabel,
        line_id: null,
        lot_id: null,
        cause_code: "insufficient_margin",
        margin_bucket: marginBucket,
        reason_labels: [
          `Marge ${formatPercentBp(input.versionMarginBp)} sous le minimum ${formatPercentBp(input.marginThresholdBp)}.`,
        ],
        provenance: [
          buildFactEntry(
            "Marge version",
            "Estimate version",
            formatPercentBp(input.versionMarginBp)
          ),
          buildInferenceEntry(
            "Seuil de marge",
            "Regles de devis / fallback radar",
            formatPercentBp(input.marginThresholdBp)
          ),
        ],
        metadata: {
          version_margin_bp: input.versionMarginBp,
          margin_threshold_bp: input.marginThresholdBp,
        },
      })
    );
  }

  if (input.missingPieces.length > 0) {
    candidates.push(
      createCandidate({
        scope_type: "project",
        scope_ref: input.projectId,
        scope_id: input.projectId,
        scope_label: input.projectLabel,
        line_id: null,
        lot_id: null,
        cause_code: "missing_piece",
        margin_bucket: marginBucket,
        reason_labels: dedupeStrings(input.missingPieces.map((piece) => piece.label)),
        provenance: mergeProvenanceEntries(
          input.missingPieces.map((piece) =>
            buildInferenceEntry(
              piece.label,
              "Workspace intake",
              `Signal ${piece.severity} derive des pieces detectees dans l'intake.`
            )
          )
        ),
        metadata: {
          missing_piece_codes: input.missingPieces.map((piece) => piece.code),
        },
      })
    );
  }

  return {
    candidates,
    lotLabelById,
  };
}

export function normalizeRiskAlertRow(
  row: Record<string, unknown>
): TakeoffRiskAlert | null {
  const alertId = typeof row.id === "string" ? row.id : null;
  const scopeType = typeof row.scope_type === "string" ? row.scope_type : null;
  const causeCode = typeof row.cause_code === "string" ? row.cause_code : null;
  const severity = typeof row.severity === "string" ? row.severity : null;
  const status = typeof row.status === "string" ? row.status : null;

  if (
    !alertId ||
    (scopeType !== "project" && scopeType !== "lot" && scopeType !== "line") ||
    !causeCode ||
    (severity !== "info" && severity !== "warning" && severity !== "critical") ||
    (status !== "to_process" && status !== "assumed" && status !== "false_positive")
  ) {
    return null;
  }

  const rawReasonLabels = Array.isArray(row.reason_labels) ? row.reason_labels : [];
  const rawProvenance = Array.isArray(row.provenance) ? row.provenance : [];

  return {
    alert_id: alertId,
    scope_type: scopeType,
    scope_id: typeof row.scope_id === "string" ? row.scope_id : null,
    scope_label: typeof row.scope_label === "string" ? row.scope_label : "Signal de risque",
    line_id: typeof row.line_id === "string" ? row.line_id : null,
    lot_id: typeof row.lot_id === "string" ? row.lot_id : null,
    cause_code: causeCode as TakeoffRiskCauseCode,
    cause_label: RISK_CAUSE_LABELS[causeCode as TakeoffRiskCauseCode] ?? causeCode,
    severity: severity,
    risk_score: typeof row.risk_score === "number" ? row.risk_score : 0,
    status: status,
    margin_bucket:
      row.margin_bucket === "negative" ||
      row.margin_bucket === "thin" ||
      row.margin_bucket === "healthy" ||
      row.margin_bucket === "unknown"
        ? row.margin_bucket
        : "unknown",
    reason_labels: rawReasonLabels.filter((value): value is string => typeof value === "string"),
    provenance: rawProvenance
      .map((entry) => {
        if (!isRecord(entry)) {
          return null;
        }

        const kind = entry.kind;
        if (kind !== "fact" && kind !== "hypothesis" && kind !== "inference") {
          return null;
        }

        return {
          kind: kind as TakeoffDpgfComparisonEvidenceKind,
          label: typeof entry.label === "string" ? entry.label : "Signal",
          source: typeof entry.source === "string" ? entry.source : "Source inconnue",
          confidence_score:
            typeof entry.confidence_score === "number" ? entry.confidence_score : null,
          note: typeof entry.note === "string" ? entry.note : null,
        } satisfies TakeoffRiskProvenanceEntry;
      })
      .filter((entry): entry is TakeoffRiskProvenanceEntry => entry !== null),
    review_note: typeof row.review_note === "string" ? row.review_note : null,
    reviewed_at: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    reviewed_by: typeof row.reviewed_by === "string" ? row.reviewed_by : null,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
    metadata: isRecord(row.metadata) ? row.metadata : {},
  };
}

export function buildTakeoffRowRiskMap(alerts: TakeoffRiskAlert[]) {
  return summarizeTakeoffLineRiskByLineId(alerts);
}
