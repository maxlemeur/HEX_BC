import type {
  TakeoffDpgfComparisonProof,
  TakeoffDpgfReviewDecision,
  TakeoffDpgfReviewStatus,
  TakeoffRiskSeverity,
  TakeoffRiskStatus,
} from "@/lib/takeoff/types";

export type ReviewStatusFilter = TakeoffDpgfReviewStatus | "all";
export type SortKey = "position" | "confidence_desc" | "delta_desc" | "matching_desc";
export type ProofKind = TakeoffDpgfComparisonProof["kind"];

export const STATUS_LABELS: Record<ReviewStatusFilter, string> = {
  all: "Tous statuts",
  reliable_match: "Fiable",
  to_confirm: "À confirmer",
  significant_gap: "Écart fort",
  unlinked: "Sans preuve",
  forced_manual: "Revue manuelle",
};

export const STATUS_BADGE_VARIANT: Record<
  TakeoffDpgfReviewStatus,
  "success" | "warning" | "danger" | "neutral" | "info"
> = {
  reliable_match: "success",
  to_confirm: "warning",
  significant_gap: "danger",
  unlinked: "neutral",
  forced_manual: "info",
};

export const STATUS_PANEL_CSS: Record<TakeoffDpgfReviewStatus, string> = {
  reliable_match: "border-success-border bg-success-subtle",
  to_confirm: "border-warning-border bg-warning-subtle",
  significant_gap: "border-danger-border bg-danger-subtle",
  unlinked: "border-border bg-surface-subtle/80",
  forced_manual: "border-info-border bg-info-subtle",
};

export const DECISION_LABELS: Record<TakeoffDpgfReviewDecision, string> = {
  keep_dpgf: "Garder DPGF",
  keep_takeoff: "Garder métré",
  manual_fix: "Corriger manuellement",
  out_of_scope: "Hors périmètre",
};

export const DECISION_VARIANT: Record<
  TakeoffDpgfReviewDecision,
  "secondary" | "primary" | "ghost" | "danger"
> = {
  keep_dpgf: "secondary",
  keep_takeoff: "primary",
  manual_fix: "ghost",
  out_of_scope: "danger",
};

export const PROOF_KIND_LABELS: Record<ProofKind, string> = {
  fact: "Faits",
  hypothesis: "Hypothèses",
  inference: "Inférences",
};

export const RISK_SEVERITY_LABELS: Record<TakeoffRiskSeverity, string> = {
  info: "Info",
  warning: "Attention",
  critical: "Critique",
};

export const RISK_SEVERITY_VARIANT: Record<
  TakeoffRiskSeverity,
  "info" | "warning" | "danger"
> = {
  info: "info",
  warning: "warning",
  critical: "danger",
};

export const RISK_STATUS_LABELS: Record<TakeoffRiskStatus, string> = {
  to_process: "À traiter",
  assumed: "Assumé",
  false_positive: "Faux positif",
};

export const RISK_STATUS_VARIANT: Record<
  TakeoffRiskStatus,
  "warning" | "success" | "neutral"
> = {
  to_process: "warning",
  assumed: "success",
  false_positive: "neutral",
};

export const PROOF_TYPE_LABELS: Record<TakeoffDpgfComparisonProof["type"], string> = {
  dpgf: "DPGF",
  takeoff: "Métré",
  plan_zone: "Plan",
  formula: "Formule",
  price_source: "Prix",
  comment: "Note",
};

export const PROOF_TYPE_BORDER: Record<TakeoffDpgfComparisonProof["type"], string> = {
  dpgf: "border-l-subtle-foreground",
  takeoff: "border-l-info",
  plan_zone: "border-l-primary",
  formula: "border-l-warning",
  price_source: "border-l-success",
  comment: "border-l-success-border",
};

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "position", label: "Position DPGF" },
  { value: "confidence_desc", label: "Confiance décr." },
  { value: "delta_desc", label: "Écart décr." },
  { value: "matching_desc", label: "Pertinence décr." },
];

export const STATUS_OPTIONS: Array<{ value: ReviewStatusFilter; label: string }> = [
  { value: "all", label: STATUS_LABELS.all },
  { value: "reliable_match", label: STATUS_LABELS.reliable_match },
  { value: "to_confirm", label: STATUS_LABELS.to_confirm },
  { value: "significant_gap", label: STATUS_LABELS.significant_gap },
  { value: "unlinked", label: STATUS_LABELS.unlinked },
  { value: "forced_manual", label: STATUS_LABELS.forced_manual },
];
