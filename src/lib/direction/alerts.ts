import type {
  TakeoffRiskAlert,
  TakeoffRiskSeverity,
  TakeoffRiskStatus,
} from "@/lib/takeoff/types";

export type DirectionAlertLevel = TakeoffRiskSeverity;

export type DirectionSyntheticAlert = {
  alertKey: string;
  projectId: string;
  projectName: string;
  versionId: string;
  jobId: string | null;
  latestJobId: string | null;
  level: DirectionAlertLevel;
  label: string;
  reasons: string[];
  status: TakeoffRiskStatus;
  alertIds: string[];
  lotLabels: string[];
};

export type BuildDirectionSyntheticAlertsInput = {
  projectId: string;
  projectName: string;
  versionId: string;
  amountHtCents: number;
  marginBp: number | null;
  discountBp: number | null;
  approvalStatus:
    | "not_required"
    | "required"
    | "in_review"
    | "approved"
    | "changes_requested";
  exceptionCount: number;
  openHypothesesCount: number;
  riskScore: number;
  sendTargetAt: string | null;
  latestJobId: string | null;
  alerts: TakeoffRiskAlert[];
};

const HIGH_VALUE_THRESHOLD_CENTS = 2_500_000;
const LOW_MARGIN_THRESHOLD_BP = 1_200;
const STRONG_DISCOUNT_THRESHOLD_BP = 800;

function severityRank(value: TakeoffRiskSeverity) {
  switch (value) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
    default:
      return 1;
  }
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

function formatPercent(valueBp: number | null) {
  if (valueBp === null || !Number.isFinite(valueBp)) {
    return "n/a";
  }

  return `${(valueBp / 100).toFixed(1)} %`;
}

function deriveGroupStatus(alerts: TakeoffRiskAlert[]): TakeoffRiskStatus {
  if (alerts.some((alert) => alert.status === "to_process")) {
    return "to_process";
  }

  if (alerts.some((alert) => alert.status === "assumed")) {
    return "assumed";
  }

  return "false_positive";
}

function deriveGroupLevel(
  alerts: TakeoffRiskAlert[],
  fallback: TakeoffRiskSeverity
): TakeoffRiskSeverity {
  return (
    [...alerts]
      .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
      .at(0)?.severity ?? fallback
  );
}

function collectLotLabels(alerts: TakeoffRiskAlert[]) {
  return dedupeStrings(
    alerts
      .map((alert) =>
        alert.scope_type === "lot" ? alert.scope_label : null
      )
      .filter((value): value is string => Boolean(value))
  );
}

function resolveAlertJobId(alert: TakeoffRiskAlert) {
  if (typeof alert.takeoff_job_id === "string") {
    return alert.takeoff_job_id;
  }

  const metadata =
    typeof alert.metadata === "object" && alert.metadata !== null
      ? (alert.metadata as Record<string, unknown>)
      : {};

  return (
    (typeof metadata.takeoff_job_id === "string"
      ? metadata.takeoff_job_id
      : null) ??
    (typeof metadata.takeoffJobId === "string"
      ? metadata.takeoffJobId
      : null)
  );
}

function resolveSharedAlertJobId(alerts: TakeoffRiskAlert[]) {
  const jobIds = dedupeStrings(
    alerts
      .map((alert) => resolveAlertJobId(alert))
      .filter((jobId): jobId is string => Boolean(jobId))
  );

  return jobIds.length === 1 ? jobIds[0] : null;
}

function buildAlertGroup(
  input: BuildDirectionSyntheticAlertsInput,
  key: string,
  label: string,
  reasons: string[],
  alerts: TakeoffRiskAlert[],
  fallbackSeverity: TakeoffRiskSeverity
): DirectionSyntheticAlert | null {
  if (alerts.length === 0) {
    return null;
  }

  return {
    alertKey: `${input.projectId}:${input.versionId}:${key}`,
    projectId: input.projectId,
    projectName: input.projectName,
    versionId: input.versionId,
    jobId: input.latestJobId ?? resolveSharedAlertJobId(alerts),
    latestJobId: input.latestJobId,
    level: deriveGroupLevel(alerts, fallbackSeverity),
    label,
    reasons: dedupeStrings(reasons).slice(0, 3),
    status: deriveGroupStatus(alerts),
    alertIds: alerts.map((alert) => alert.alert_id),
    lotLabels: collectLotLabels(alerts),
  };
}

function isDueWithin(sendTargetAt: string | null, days: number) {
  if (!sendTargetAt) {
    return false;
  }

  const targetMs = new Date(sendTargetAt).getTime();
  if (!Number.isFinite(targetMs)) {
    return false;
  }

  const diffMs = targetMs - Date.now();
  return diffMs <= days * 24 * 60 * 60 * 1000;
}

export function buildDirectionSyntheticAlerts(
  input: BuildDirectionSyntheticAlertsInput
): DirectionSyntheticAlert[] {
  const alerts = input.alerts;
  if (alerts.length === 0) {
    return [];
  }

  const alertsByCause = {
    missingProof: alerts.filter((alert) => alert.cause_code === "missing_proof"),
    missingPiece: alerts.filter((alert) => alert.cause_code === "missing_piece"),
    quantityGap: alerts.filter((alert) => alert.cause_code === "dpgf_takeoff_gap"),
    priceSignals: alerts.filter(
      (alert) =>
        alert.cause_code === "atypical_price" ||
        alert.cause_code === "insufficient_margin"
    ),
  };

  const groups: Array<DirectionSyntheticAlert | null> = [];
  const hasLowMargin =
    input.marginBp !== null && input.marginBp <= LOW_MARGIN_THRESHOLD_BP;
  const hasHighValue = input.amountHtCents >= HIGH_VALUE_THRESHOLD_CENTS;
  const hasStrongDiscount =
    (input.discountBp ?? 0) >= STRONG_DISCOUNT_THRESHOLD_BP;
  const dueThisWeek = isDueWithin(input.sendTargetAt, 7);

  if (
    hasLowMargin &&
    (alertsByCause.quantityGap.length > 0 || alertsByCause.priceSignals.length > 0)
  ) {
    groups.push(
      buildAlertGroup(
        input,
        "margin-fragile",
        "Marge fragile avec ecarts ouverts",
        [
          `Marge previsionnelle a ${formatPercent(input.marginBp)}.`,
          `${input.exceptionCount} exception${input.exceptionCount > 1 ? "s" : ""} reste${
            input.exceptionCount > 1 ? "nt" : ""
          } a arbitrer.`,
        ],
        [...alertsByCause.quantityGap, ...alertsByCause.priceSignals],
        "critical"
      )
    );
  }

  if (hasHighValue && alertsByCause.missingProof.length > 0) {
    groups.push(
      buildAlertGroup(
        input,
        "high-value-missing-proof",
        "Montant eleve avec preuves a consolider",
        [
          "Le montant engage l'affaire au-dessus du seuil de vigilance.",
          `${alertsByCause.missingProof.length} preuve${
            alertsByCause.missingProof.length > 1 ? "s" : ""
          } manquante${alertsByCause.missingProof.length > 1 ? "s" : ""}.`,
        ],
        alertsByCause.missingProof,
        "critical"
      )
    );
  }

  if (
    hasStrongDiscount &&
    input.approvalStatus !== "approved" &&
    input.approvalStatus !== "not_required"
  ) {
    groups.push(
      buildAlertGroup(
        input,
        "discount-awaiting-approval",
        "Remise forte sans validation finalisee",
        [
          `Remise courante a ${formatPercent(input.discountBp)}.`,
          "Le dossier n'est pas encore valide pour l'envoi.",
        ],
        alerts,
        "warning"
      )
    );
  }

  if (
    dueThisWeek &&
    (input.openHypothesesCount > 0 || alertsByCause.missingPiece.length > 0)
  ) {
    groups.push(
      buildAlertGroup(
        input,
        "deadline-incomplete",
        "Dossier incomplet avant echeance",
        [
          input.sendTargetAt
            ? `Échéance detectee avant la fin de semaine (${new Date(
                input.sendTargetAt
              ).toLocaleDateString("fr-FR")}).`
            : "Une echeance proche demande un arbitrage rapide.",
          input.openHypothesesCount > 0
            ? `${input.openHypothesesCount} hypothese${
                input.openHypothesesCount > 1 ? "s" : ""
              } reste${input.openHypothesesCount > 1 ? "nt" : ""} ouverte${
                input.openHypothesesCount > 1 ? "s" : ""
              }.`
            : "Des pieces restent a confirmer avant envoi.",
        ],
        alertsByCause.missingPiece.length > 0 ? alertsByCause.missingPiece : alerts,
        "critical"
      )
    );
  }

  if (!groups.some((group) => group !== null)) {
    const fallback = buildAlertGroup(
      input,
      "generic",
      "Signal a traiter avant arbitrage",
      [
        alerts[0]?.cause_label ?? "Un signal de risque reste ouvert.",
        input.riskScore > 0 ? `Score risque ${input.riskScore}/100.` : "",
      ],
      alerts,
      alerts[0]?.severity ?? "warning"
    );

    if (fallback) {
      groups.push(fallback);
    }
  }

  return groups
    .filter((group): group is DirectionSyntheticAlert => group !== null)
    .sort((left, right) => severityRank(right.level) - severityRank(left.level));
}
