"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import {
  isTakeoffApiError,
  saveTakeoffDpgfManualLink,
  saveTakeoffReviewDecision,
} from "@/lib/takeoff/client";
import type {
  TakeoffDpgfComparisonProof,
  TakeoffDpgfComparisonResponse,
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonUnusedTakeoffItem,
  TakeoffDpgfComparisonView,
  TakeoffDpgfReviewDecision,
  TakeoffDpgfReviewStatus,
} from "@/lib/takeoff/types";

type TakeoffDpgfCompareViewProps = {
  data: TakeoffDpgfComparisonResponse;
  currentView: TakeoffDpgfComparisonView;
  onViewChange: (view: TakeoffDpgfComparisonView) => void;
  onRefresh: () => void;
};

type ReviewStatusFilter = TakeoffDpgfReviewStatus | "all";
type SortKey = "position" | "confidence_desc" | "delta_desc" | "matching_desc";
type ProofKind = TakeoffDpgfComparisonProof["kind"];

type ManualLinkModalProps = {
  open: boolean;
  row: TakeoffDpgfComparisonRow | null;
  rows: TakeoffDpgfComparisonRow[];
  manualLinkCandidates: TakeoffDpgfComparisonUnusedTakeoffItem[];
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (takeoffItemIds: string[]) => Promise<void>;
  onSaveHypothesis: (hypothesisText: string) => Promise<void>;
};

type ManualLinkCandidate = TakeoffDpgfComparisonUnusedTakeoffItem & {
  is_current: boolean;
  linked_line_label: string | null;
};

const STATUS_LABELS: Record<ReviewStatusFilter, string> = {
  all: "Tous statuts",
  reliable_match: "Fiable",
  to_confirm: "À confirmer",
  significant_gap: "Écart fort",
  unlinked: "Sans preuve",
  forced_manual: "Revue manuelle",
};

const STATUS_BADGE_VARIANT: Record<
  TakeoffDpgfReviewStatus,
  "success" | "warning" | "error" | "neutral" | "info"
> = {
  reliable_match: "success",
  to_confirm: "warning",
  significant_gap: "error",
  unlinked: "neutral",
  forced_manual: "info",
};

const STATUS_PANEL_CSS: Record<TakeoffDpgfReviewStatus, string> = {
  reliable_match: "border-emerald-200 bg-emerald-50/70",
  to_confirm: "border-amber-200 bg-amber-50/70",
  significant_gap: "border-rose-200 bg-rose-50/70",
  unlinked: "border-slate-200 bg-slate-50/80",
  forced_manual: "border-sky-200 bg-sky-50/70",
};

const DECISION_LABELS: Record<TakeoffDpgfReviewDecision, string> = {
  keep_dpgf: "Garder DPGF",
  keep_takeoff: "Garder métré",
  manual_fix: "Corriger manuellement",
  out_of_scope: "Hors périmètre",
};

const DECISION_VARIANT: Record<
  TakeoffDpgfReviewDecision,
  "secondary" | "primary" | "ghost" | "danger"
> = {
  keep_dpgf: "secondary",
  keep_takeoff: "primary",
  manual_fix: "ghost",
  out_of_scope: "danger",
};

const PROOF_KIND_LABELS: Record<ProofKind, string> = {
  fact: "Faits",
  hypothesis: "Hypothèses",
  inference: "Inférences",
};

const PROOF_TYPE_LABELS: Record<TakeoffDpgfComparisonProof["type"], string> = {
  dpgf: "DPGF",
  takeoff: "Métré",
  plan_zone: "Plan",
  formula: "Formule",
  comment: "Note",
};

const PROOF_TYPE_BORDER: Record<TakeoffDpgfComparisonProof["type"], string> = {
  dpgf: "border-l-slate-400",
  takeoff: "border-l-sky-400",
  plan_zone: "border-l-violet-400",
  formula: "border-l-amber-400",
  comment: "border-l-emerald-400",
};

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "position", label: "Position DPGF" },
  { value: "confidence_desc", label: "Confiance décr." },
  { value: "delta_desc", label: "Écart décr." },
  { value: "matching_desc", label: "Pertinence décr." },
];

const STATUS_OPTIONS: Array<{ value: ReviewStatusFilter; label: string }> = [
  { value: "all", label: STATUS_LABELS.all },
  { value: "reliable_match", label: STATUS_LABELS.reliable_match },
  { value: "to_confirm", label: STATUS_LABELS.to_confirm },
  { value: "significant_gap", label: STATUS_LABELS.significant_gap },
  { value: "unlinked", label: STATUS_LABELS.unlinked },
  { value: "forced_manual", label: STATUS_LABELS.forced_manual },
];

function formatNumber(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) return "-";

  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatConfidence(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Indéterminée";
  return `${Math.round(value * 100)}%`;
}

function getDecisionImpactText(
  decision: TakeoffDpgfReviewDecision | null,
  row: TakeoffDpgfComparisonRow | null,
): string | null {
  if (!decision || !row) return null;
  const unit = row.quantity_unit ?? "";
  switch (decision) {
    case "keep_dpgf":
      return `Quantité retenue : ${formatNumber(row.dpgf_quantity)} ${unit}`.trim();
    case "keep_takeoff":
      if (row.takeoff_quantity === null) return "Quantité takeoff non consolidée";
      return `Quantité retenue : ${formatNumber(row.takeoff_quantity)} ${unit} (${formatPercent(row.delta_percent)})`.trim();
    case "manual_fix":
      return "Vous devrez saisir la quantité corrigée manuellement.";
    case "out_of_scope":
      return "Cette ligne sera exclue du chiffrage.";
  }
}

function formatProofConfidence(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "Confiance n/a";
  return `Confiance ${Math.round(value * 100)}%`;
}

function buildSearchText(row: TakeoffDpgfComparisonRow) {
  return [
    row.line_label,
    row.dpgf.description,
    row.linked_takeoff_items.map((item) => item.designation).join(" "),
    row.proofs
      .map((proof) => [proof.label, proof.source, proof.note].filter(Boolean).join(" "))
      .join(" "),
    row.applied_decision?.reason,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("fr-FR");
}

function sortRows(rows: TakeoffDpgfComparisonRow[], sortKey: SortKey) {
  return [...rows].sort((left, right) => {
    switch (sortKey) {
      case "confidence_desc":
        return right.confidence_score - left.confidence_score;
      case "delta_desc":
        return Math.abs(right.delta_percent ?? -1) - Math.abs(left.delta_percent ?? -1);
      case "matching_desc":
        return right.matching_score - left.matching_score;
      case "position":
      default:
        return left.dpgf.position - right.dpgf.position;
    }
  });
}

function toCsvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value).replaceAll("\"", "\"\"");
  return `"${stringValue}"`;
}

function exportRowsAsCsv(rows: TakeoffDpgfComparisonRow[]) {
  const header = [
    "position_dpgf",
    "ligne",
    "statut_review",
    "decision_suggeree",
    "decision_appliquee",
    "provenance_decision",
    "matched_by",
    "quantite_dpgf",
    "quantite_takeoff",
    "unite",
    "delta_absolu",
    "delta_percent",
    "matching_score",
    "confidence_score",
    "preuves",
  ];
  const lines = rows.map((row) =>
    [
      row.dpgf.position,
      row.line_label,
      STATUS_LABELS[row.review_status],
      row.suggested_decision ? DECISION_LABELS[row.suggested_decision] : "",
      row.applied_decision ? DECISION_LABELS[row.applied_decision.decision] : "",
      row.applied_decision
        ? row.applied_decision.source === "carried_over"
          ? `carried_over_v${row.applied_decision.carried_over_from_version_number ?? "?"}`
          : "current_version"
        : "",
      row.matched_by ?? "",
      row.dpgf_quantity,
      row.takeoff_quantity,
      row.quantity_unit,
      row.delta_absolute,
      row.delta_percent,
      row.matching_score,
      row.confidence_score,
      row.proofs.map((proof) => `${PROOF_KIND_LABELS[proof.kind]}:${proof.label}`).join(" | "),
    ]
      .map((cell) => toCsvCell(cell))
      .join(",")
  );

  const content = [header.join(","), ...lines].join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "takeoff-dpgf-review.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function SummaryCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-white/90 p-4 shadow-sm">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${accent}`}>{value}</p>
    </div>
  );
}

export function buildManualLinkCandidates(input: {
  row: TakeoffDpgfComparisonRow | null;
  rows: TakeoffDpgfComparisonRow[];
  manualLinkCandidates: TakeoffDpgfComparisonUnusedTakeoffItem[];
}): ManualLinkCandidate[] {
  if (!input.row) {
    return [];
  }

  const currentIds = new Set(input.row.linked_takeoff_items.map((item) => item.item_id));
  const linkedLineLabelByItemId = new Map<string, string>();

  for (const compareRow of input.rows) {
    if (compareRow.line_id === input.row.line_id) {
      continue;
    }

    for (const item of compareRow.linked_takeoff_items) {
      linkedLineLabelByItemId.set(item.item_id, compareRow.line_label);
    }
  }

  return input.manualLinkCandidates
    .map((item) => ({
      ...item,
      is_current: currentIds.has(item.item_id),
      linked_line_label: linkedLineLabelByItemId.get(item.item_id) ?? null,
    }))
    .sort((left, right) => {
      if (left.is_current !== right.is_current) {
        return left.is_current ? -1 : 1;
      }

      return left.designation.localeCompare(right.designation, "fr-FR");
    });
}

function ManualLinkModal({
  open,
  row,
  rows,
  manualLinkCandidates,
  saving,
  onOpenChange,
  onSave,
  onSaveHypothesis,
}: Readonly<ManualLinkModalProps>) {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => row?.linked_takeoff_items.map((item) => item.item_id) ?? []
  );
  const [mode, setMode] = useState<"takeoff_items" | "hypothesis">("takeoff_items");
  const [hypothesisText, setHypothesisText] = useState("");

  useEffect(() => {
    setSelectedIds(row?.linked_takeoff_items.map((item) => item.item_id) ?? []);
    setMode("takeoff_items");
    setHypothesisText("");
  }, [row]);

  const candidates = useMemo(() => {
    return buildManualLinkCandidates({
      row,
      rows,
      manualLinkCandidates,
    });
  }, [manualLinkCandidates, row, rows]);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content className="max-w-3xl">
        <Modal.Header>
          <Modal.Title>Lier manuellement des items takeoff</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
              Ligne DPGF
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
              {row?.line_label ?? "Ligne inconnue"}
            </p>
            <p className="mt-1 text-sm text-[var(--slate-600)]">
              Quantité DPGF : {formatNumber(row?.dpgf_quantity ?? null)} {row?.dpgf.unit ?? ""}
            </p>
          </div>

          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mode === "takeoff_items"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              onClick={() => setMode("takeoff_items")}
            >
              Items takeoff
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mode === "hypothesis"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              onClick={() => setMode("hypothesis")}
            >
              Hypothèse manuelle
            </button>
          </div>

          {mode === "takeoff_items" ? (
            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {candidates.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--slate-50)] p-6 text-sm text-[var(--slate-600)]">
                  Aucun item takeoff disponible pour un lien manuel.
                </div>
              ) : (
                candidates.map((candidate) => {
                  const checked = selectedIds.includes(candidate.item_id);

                  return (
                    <label
                      key={candidate.item_id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                        checked
                          ? "border-sky-300 bg-sky-50/80"
                          : "border-[var(--border)] bg-white hover:bg-[var(--slate-50)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={() => {
                          setSelectedIds((current) =>
                            checked
                              ? current.filter((itemId) => itemId !== candidate.item_id)
                              : [...current, candidate.item_id]
                          );
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-[var(--slate-900)]">
                            {candidate.designation}
                          </p>
                          {candidate.is_current ? (
                            <Badge variant="info" size="sm">
                              Actuellement relié
                            </Badge>
                          ) : null}
                          {candidate.linked_line_label ? (
                            <Badge variant="warning" size="sm">
                              Relié à {candidate.linked_line_label}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-[var(--slate-600)]">
                          {formatNumber(candidate.quantity)} {candidate.unit} ·{" "}
                          {candidate.source_file_name ?? "Source inconnue"}
                          {candidate.source_page ? ` · p.${candidate.source_page}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-[var(--slate-500)]">
                          {formatProofConfidence(candidate.confidence_score)}
                        </p>
                        {candidate.evidence ? (
                          <p className="mt-2 text-xs text-[var(--slate-600)]">
                            {candidate.evidence}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--slate-600)]">
                Décrivez votre hypothèse de quantité ou de périmètre pour cette ligne. Elle sera
                enregistrée comme décision « corriger manuellement » et apparaîtra dans le panneau
                de preuves sous forme d&apos;hypothèse après rafraîchissement.
              </p>
              <textarea
                autoComplete="off"
                className="form-input min-h-[160px] py-3"
                value={hypothesisText}
                placeholder="Ex : La quantité DPGF semble inclure les réserves techniques non visibles sur les plans. Je retiens 120 m² en attendant confirmation du maître d'œuvre…"
                onChange={(event) => setHypothesisText(event.target.value)}
                maxLength={2000}
              />
              <p className="text-xs text-[var(--slate-500)]">
                {hypothesisText.length} / 2 000 caractères
              </p>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>Annuler</Modal.Close>
          {mode === "takeoff_items" ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onSave([])}
                disabled={saving || !row}
              >
                Retirer le lien manuel
              </Button>
              <Button
                size="sm"
                loading={saving}
                disabled={!row}
                onClick={() => void onSave(selectedIds)}
              >
                Enregistrer la sélection
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              loading={saving}
              disabled={!row || hypothesisText.trim().length === 0}
              onClick={() => void onSaveHypothesis(hypothesisText.trim())}
            >
              Enregistrer l&apos;hypothèse
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

function ProofList({
  label,
  proofs,
}: {
  label: string;
  proofs: TakeoffDpgfComparisonProof[];
}) {
  if (proofs.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--slate-50)] p-4">
        <p className="text-sm font-medium text-[var(--slate-800)]">{label}</p>
        <p className="mt-2 text-sm text-[var(--slate-600)]">Aucun élément.</p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">{label}</p>
      {proofs.map((proof) => (
        <article
          key={proof.proof_id}
          className={`rounded-2xl border border-[var(--border)] border-l-4 ${PROOF_TYPE_BORDER[proof.type]} bg-white p-4 shadow-sm`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-[var(--slate-900)]">{proof.label}</p>
            <Badge variant="neutral" size="sm">
              {PROOF_TYPE_LABELS[proof.type]}
            </Badge>
            {proof.type === "plan_zone" && proof.source ? (
              <Badge variant="info" size="sm">
                {proof.source}
              </Badge>
            ) : null}
            {proof.type === "formula" ? (
              <Badge variant="warning" size="sm">
                Agrégation
              </Badge>
            ) : null}
          </div>
          {proof.type !== "plan_zone" ? (
            <p className="mt-2 text-xs text-[var(--slate-600)]">Source : {proof.source}</p>
          ) : null}
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            {formatProofConfidence(proof.confidence_score)}
          </p>
          {proof.note ? (
            proof.type === "comment" ? (
              <blockquote className="mt-2 border-l-2 border-emerald-300 pl-3 text-sm italic leading-6 text-[var(--slate-700)]">
                {proof.note}
              </blockquote>
            ) : (
              <p className="mt-2 text-sm leading-6 text-[var(--slate-700)]">{proof.note}</p>
            )
          ) : null}
        </article>
      ))}
    </section>
  );
}

function DecisionPill({
  active,
  decision,
  onClick,
}: {
  active: boolean;
  decision: TakeoffDpgfReviewDecision;
  onClick: (decision: TakeoffDpgfReviewDecision) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "primary" : DECISION_VARIANT[decision]}
      className={!active ? "justify-start" : undefined}
      onClick={() => onClick(decision)}
    >
      {DECISION_LABELS[decision]}
    </Button>
  );
}

export default function TakeoffDpgfCompareView({
  data,
  currentView,
  onViewChange,
  onRefresh,
}: Readonly<TakeoffDpgfCompareViewProps>) {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("position");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(data.rows[0]?.line_id ?? null);
  const [manualLinkModalOpen, setManualLinkModalOpen] = useState(false);
  const [manualLinkSaving, setManualLinkSaving] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [draftDecision, setDraftDecision] = useState<TakeoffDpgfReviewDecision | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [isToolbarPending, startToolbarTransition] = useTransition();

  useEffect(() => {
    if (data.rows.some((row) => row.line_id === selectedRowId)) {
      return;
    }

    setSelectedRowId(data.rows[0]?.line_id ?? null);
  }, [data.rows, selectedRowId]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLocaleLowerCase("fr-FR");

    return sortRows(
      data.rows.filter((row) => {
        if (statusFilter !== "all" && row.review_status !== statusFilter) {
          return false;
        }

        if (normalizedQuery.length === 0) {
          return true;
        }

        return buildSearchText(row).includes(normalizedQuery);
      }),
      sortKey
    );
  }, [data.rows, deferredSearchQuery, sortKey, statusFilter]);

  const selectedRow =
    filteredRows.find((row) => row.line_id === selectedRowId) ??
    data.rows.find((row) => row.line_id === selectedRowId) ??
    filteredRows[0] ??
    data.rows[0] ??
    null;

  useEffect(() => {
    if (!selectedRow) {
      setDraftDecision(null);
      setDecisionReason("");
      return;
    }

    setDraftDecision(
      selectedRow.applied_decision?.decision ?? selectedRow.suggested_decision ?? null
    );
    setDecisionReason(selectedRow.applied_decision?.reason ?? "");
  }, [selectedRow]);

  const exceptionCounts = useMemo(() => {
    const source = data.rows;
    return {
      significant_gap: source.filter((r) => r.review_status === "significant_gap").length,
      to_confirm: source.filter((r) => r.review_status === "to_confirm").length,
      unlinked: source.filter((r) => r.review_status === "unlinked").length,
    };
  }, [data.rows]);

  const proofGroups = useMemo(() => {
    if (!selectedRow) {
      return {
        fact: [],
        hypothesis: [],
        inference: [],
      } satisfies Record<ProofKind, TakeoffDpgfComparisonProof[]>;
    }

    return {
      fact: selectedRow.proofs.filter((proof) => proof.kind === "fact"),
      hypothesis: selectedRow.proofs.filter((proof) => proof.kind === "hypothesis"),
      inference: selectedRow.proofs.filter((proof) => proof.kind === "inference"),
    } satisfies Record<ProofKind, TakeoffDpgfComparisonProof[]>;
  }, [selectedRow]);

  const handleViewChange = (nextView: TakeoffDpgfComparisonView) => {
    if (nextView === currentView) return;

    startTransition(() => {
      onViewChange(nextView);
    });
  };

  const handleManualLinkSave = async (takeoffItemIds: string[]) => {
    if (!selectedRow) return;

    setManualLinkSaving(true);
    try {
      await saveTakeoffDpgfManualLink(data.job_id, {
        version_id: data.version_id,
        estimate_item_id: selectedRow.dpgf.estimate_item_id,
        takeoff_item_ids: takeoffItemIds,
      });

      toast.success({
        title: "Lien manuel mis à jour",
        description:
          takeoffItemIds.length > 0
            ? `${takeoffItemIds.length} item(s) reliés à la ligne DPGF.`
            : "La ligne repasse sans lien manuel explicite.",
      });
      setManualLinkModalOpen(false);
      onRefresh();
    } catch (error) {
      toast.error({
        title: "Impossible de sauvegarder le lien manuel",
        description: isTakeoffApiError(error) ? error.message : "Erreur inconnue.",
      });
    } finally {
      setManualLinkSaving(false);
    }
  };

  const handleHypothesisSave = async (hypothesisText: string) => {
    if (!selectedRow) return;
    setManualLinkSaving(true);
    try {
      await saveTakeoffReviewDecision(data.job_id, {
        version_id: data.version_id,
        estimate_item_id: selectedRow.dpgf.estimate_item_id,
        decision: "manual_fix",
        reason: hypothesisText,
      });
      toast.success({
        title: "Hypothèse enregistrée",
        description: `Hypothèse appliquée à la ligne ${selectedRow.line_label}.`,
      });
      setManualLinkModalOpen(false);
      onRefresh();
    } catch (error) {
      toast.error({
        title: "Impossible d'enregistrer l'hypothèse",
        description: isTakeoffApiError(error) ? error.message : "Erreur inconnue.",
      });
    } finally {
      setManualLinkSaving(false);
    }
  };

  const handleDecisionSave = async () => {
    if (!selectedRow || !draftDecision) {
      toast.info({
        title: "Sélection incomplète",
        description: "Choisissez d'abord une décision humaine explicite.",
      });
      return;
    }

    setDecisionSaving(true);
    try {
      await saveTakeoffReviewDecision(data.job_id, {
        version_id: data.version_id,
        estimate_item_id: selectedRow.dpgf.estimate_item_id,
        decision: draftDecision,
        reason: decisionReason.trim().length > 0 ? decisionReason.trim() : null,
      });

      toast.success({
        title: "Décision enregistrée",
        description: `${DECISION_LABELS[draftDecision]} appliquée à la ligne.`,
      });
      onRefresh();
    } catch (error) {
      toast.error({
        title: "Impossible d'enregistrer la décision",
        description: isTakeoffApiError(error) ? error.message : "Erreur inconnue.",
      });
    } finally {
      setDecisionSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(140deg,rgba(248,250,252,0.95),rgba(239,246,255,0.9))] p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.18em] text-[var(--slate-500)]">
              Review preuves / prix / risque
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--slate-950)]">
              Comparaison DPGF explicable
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--slate-600)]">
              Les suggestions restent visibles mais ne sont jamais appliquées sans validation
              humaine explicite.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={currentView === "all" ? "primary" : "secondary"}
              onClick={() => handleViewChange("all")}
            >
              Tout
            </Button>
            <Button
              type="button"
              size="sm"
              variant={currentView === "exceptions_only" ? "primary" : "secondary"}
              onClick={() => handleViewChange("exceptions_only")}
            >
              Exceptions seulement
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => exportRowsAsCsv(filteredRows)}
            >
              Export CSV
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCard
            label="Fiables"
            value={data.summary.reliable_matches}
            accent="text-emerald-700"
          />
          <SummaryCard
            label="À confirmer"
            value={data.summary.to_confirm}
            accent="text-amber-700"
          />
          <SummaryCard
            label="Écarts forts"
            value={data.summary.significant_gaps}
            accent="text-rose-700"
          />
          <SummaryCard
            label="Revue manuelle"
            value={data.summary.forced_manual}
            accent="text-sky-700"
          />
          <SummaryCard
            label="Sans preuve"
            value={data.summary.lines_without_proof}
            accent="text-slate-700"
          />
          <SummaryCard
            label="Items orphelins"
            value={data.summary.unused_takeoff_items}
            accent="text-[var(--slate-900)]"
          />
        </div>
      </section>

      <section className="rounded-[28px] border border-[var(--border)] bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,260px)_minmax(220px,260px)_1fr_auto]">
          <div>
            <label className="form-label" htmlFor="dpgf-status-filter">
              Statut
            </label>
            <select
              id="dpgf-status-filter"
              className="form-input form-select form-input--sm"
              value={statusFilter}
              onChange={(event) => {
                const nextValue = event.target.value as ReviewStatusFilter;
                startToolbarTransition(() => {
                  setStatusFilter(nextValue);
                });
              }}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="dpgf-sort-key">
              Tri
            </label>
            <select
              id="dpgf-sort-key"
              className="form-input form-select form-input--sm"
              value={sortKey}
              onChange={(event) => {
                const nextValue = event.target.value as SortKey;
                startToolbarTransition(() => {
                  setSortKey(nextValue);
                });
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label" htmlFor="dpgf-search-query">
              Recherche
            </label>
            <input
              id="dpgf-search-query"
              name="dpgf_search_query"
              type="search"
              autoComplete="off"
              className="form-input form-input--sm"
              value={searchQuery}
              placeholder="Ligne DPGF, preuve, item takeoff…"
              onChange={(event) => {
                startToolbarTransition(() => {
                  setSearchQuery(event.target.value);
                });
              }}
            />
          </div>

          <div className="flex items-end">
            <Button type="button" size="sm" variant="secondary" onClick={onRefresh}>
              Rafraîchir
            </Button>
          </div>
        </div>

        <p className="mt-3 text-xs text-[var(--slate-500)]" aria-live="polite">
          {filteredRows.length} ligne(s) visibles sur {data.pagination.total} pour la vue{" "}
          {currentView === "all" ? "Tout" : "Exceptions seulement"}
          {isToolbarPending ? " · filtrage..." : ""}
        </p>

        {currentView === "exceptions_only" ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setStatusFilter(statusFilter === "significant_gap" ? "all" : "significant_gap")
              }
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                statusFilter === "significant_gap"
                  ? "bg-rose-100 text-rose-800"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {exceptionCounts.significant_gap} écarts forts
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={() =>
                setStatusFilter(statusFilter === "to_confirm" ? "all" : "to_confirm")
              }
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                statusFilter === "to_confirm"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {exceptionCounts.to_confirm} à confirmer
            </button>
            <span className="text-slate-300">·</span>
            <button
              type="button"
              onClick={() =>
                setStatusFilter(statusFilter === "unlinked" ? "all" : "unlinked")
              }
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                statusFilter === "unlinked"
                  ? "bg-slate-200 text-slate-800"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {exceptionCounts.unlinked} sans preuve
            </button>
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <section className="space-y-3">
          {filteredRows.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-[var(--border)] bg-white p-10 text-center text-sm text-[var(--slate-600)]">
              Aucun résultat pour ce filtre.
            </div>
          ) : (
            filteredRows.map((row) => {
              const isSelected = row.line_id === selectedRow?.line_id;
              const quantityLabel =
                row.takeoff_quantity === null
                  ? "Quantité takeoff non consolidée"
                  : `${formatNumber(row.takeoff_quantity)} ${row.quantity_unit ?? ""}`.trim();

              return (
                <button
                  key={row.line_id}
                  type="button"
                  className={`w-full rounded-[28px] border p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 ${
                    isSelected
                      ? "border-sky-300 bg-sky-50/80"
                      : STATUS_PANEL_CSS[row.review_status]
                  }`}
                  style={{ contentVisibility: "auto" }}
                  onClick={() => setSelectedRowId(row.line_id)}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                          Position {row.dpgf.position}
                        </p>
                        <Badge variant={STATUS_BADGE_VARIANT[row.review_status]} size="sm">
                          {STATUS_LABELS[row.review_status]}
                        </Badge>
                        {row.matched_by ? (
                          <Badge variant={row.matched_by === "manual" ? "info" : "neutral"} size="sm">
                            {row.matched_by === "manual" ? "Lien manuel" : "Auto"}
                          </Badge>
                        ) : null}
                      </div>
                      <h3 className="mt-2 text-lg font-semibold text-[var(--slate-950)]">
                        {row.line_label}
                      </h3>
                      {row.dpgf.description ? (
                        <p className="mt-1 text-sm text-[var(--slate-600)]">{row.dpgf.description}</p>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-white/60 bg-white/70 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                        Confiance
                      </p>
                      <p className="mt-1 text-lg font-semibold text-[var(--slate-950)]">
                        {formatConfidence(row.confidence_score)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <div className="rounded-2xl border border-white/70 bg-white/75 p-3">
                      <p className="text-xs text-[var(--slate-500)]">DPGF</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
                        {formatNumber(row.dpgf_quantity)} {row.dpgf.unit ?? ""}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/70 bg-white/75 p-3">
                      <p className="text-xs text-[var(--slate-500)]">Takeoff</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
                        {quantityLabel}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/70 bg-white/75 p-3">
                      <p className="text-xs text-[var(--slate-500)]">Écart</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
                        {formatNumber(row.delta_absolute)} · {formatPercent(row.delta_percent)}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/70 bg-white/75 p-3">
                      <p className="text-xs text-[var(--slate-500)]">Preuves</p>
                      <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
                        {row.proofs.length}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {row.linked_takeoff_items.length > 0 ? (
                      row.linked_takeoff_items.slice(0, 3).map((item) => (
                        <Badge key={item.item_id} variant="neutral" size="sm">
                          {item.designation}
                        </Badge>
                      ))
                    ) : (
                      <Badge variant="neutral" size="sm">
                        Aucun item takeoff relié
                      </Badge>
                    )}
                    {row.linked_takeoff_items.length > 3 ? (
                      <Badge variant="neutral" size="sm">
                        +{row.linked_takeoff_items.length - 3} autres
                      </Badge>
                    ) : null}
                  </div>
                </button>
              );
            })
          )}
        </section>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          {!selectedRow ? (
            <div className="rounded-[28px] border border-[var(--border)] bg-white p-6 shadow-sm">
              <p className="text-sm text-[var(--slate-600)]">
                Sélectionnez une ligne pour afficher les preuves, hypothèses et décisions.
              </p>
            </div>
          ) : (
            <div className="space-y-5 rounded-[28px] border border-[var(--border)] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                    Revue détaillée
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-[var(--slate-950)]">
                    {selectedRow.line_label}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--slate-600)]">
                    Position {selectedRow.dpgf.position}
                    {selectedRow.dpgf.source_file_name
                      ? ` · ${selectedRow.dpgf.source_file_name}`
                      : ""}
                    {selectedRow.dpgf.source_page ? ` · ligne ${selectedRow.dpgf.source_page}` : ""}
                  </p>
                </div>
                <Badge variant={STATUS_BADGE_VARIANT[selectedRow.review_status]}>
                  {STATUS_LABELS[selectedRow.review_status]}
                </Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                    Matching
                  </p>
                  <p className="mt-2 text-lg font-semibold text-[var(--slate-950)]">
                    {Math.round(selectedRow.matching_score * 100)}%
                  </p>
                  <p className="mt-1 text-xs text-[var(--slate-600)]">
                    Mode: {selectedRow.matched_by ?? "aucun"}
                  </p>
                </div>
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                    Suggestion IA
                  </p>
                  <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">
                    {selectedRow.suggested_decision
                      ? DECISION_LABELS[selectedRow.suggested_decision]
                      : "Aucune suggestion"}
                  </p>
                  <p className="mt-1 text-xs text-[var(--slate-600)]">
                    Confiance globale {formatConfidence(selectedRow.confidence_score)}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                      Décision humaine appliquée
                    </p>
                    <p className="mt-2 text-sm font-semibold text-[var(--slate-950)]">
                      {selectedRow.applied_decision
                        ? DECISION_LABELS[selectedRow.applied_decision.decision]
                        : "Aucune décision appliquée"}
                    </p>
                  </div>
                  {selectedRow.applied_decision ? (
                    <Badge
                      variant={
                        selectedRow.applied_decision.source === "carried_over" ? "warning" : "info"
                      }
                    >
                      {selectedRow.applied_decision.source === "carried_over"
                        ? `Reprise v${selectedRow.applied_decision.carried_over_from_version_number ?? "?"}`
                        : "Version courante"}
                    </Badge>
                  ) : null}
                </div>
                {selectedRow.applied_decision?.reason ? (
                  <p className="mt-3 text-sm leading-6 text-[var(--slate-700)]">
                    {selectedRow.applied_decision.reason}
                  </p>
                ) : null}
              </div>

              <div className="space-y-4">
                <ProofList label={PROOF_KIND_LABELS.fact} proofs={proofGroups.fact} />
                <ProofList label={PROOF_KIND_LABELS.hypothesis} proofs={proofGroups.hypothesis} />
                <ProofList label={PROOF_KIND_LABELS.inference} proofs={proofGroups.inference} />
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
                      Arbitrage humain
                    </p>
                    <p className="mt-2 text-sm text-[var(--slate-600)]">
                      Sélection explicite obligatoire avant application.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setManualLinkModalOpen(true)}
                  >
                    Recomposer les liens
                  </Button>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {(Object.keys(DECISION_LABELS) as TakeoffDpgfReviewDecision[]).map((decision) => (
                    <DecisionPill
                      key={decision}
                      active={draftDecision === decision}
                      decision={decision}
                      onClick={setDraftDecision}
                    />
                  ))}
                </div>

                {draftDecision && selectedRow ? (
                  <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    {getDecisionImpactText(draftDecision, selectedRow)}
                  </p>
                ) : null}

                <div className="mt-4">
                  <label className="form-label" htmlFor="dpgf-review-reason">
                    Justification humaine
                  </label>
                  <textarea
                    id="dpgf-review-reason"
                    name="dpgf_review_reason"
                    autoComplete="off"
                    className="form-input min-h-[120px] py-3"
                    value={decisionReason}
                    placeholder="Distinguer les faits observés, les hypothèses retenues et les corrections manuelles à faire…"
                    onChange={(event) => setDecisionReason(event.target.value)}
                    maxLength={2000}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-[var(--slate-500)]">
                    Provenance visible, confiance explicite, aucune application silencieuse.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    loading={decisionSaving}
                    onClick={() => void handleDecisionSave()}
                  >
                    Enregistrer la décision
                  </Button>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      <ManualLinkModal
        key={`${selectedRow?.line_id ?? "empty"}:${manualLinkModalOpen ? "open" : "closed"}`}
        open={manualLinkModalOpen}
        row={selectedRow}
        rows={data.rows}
        manualLinkCandidates={data.manual_link_candidates}
        saving={manualLinkSaving}
        onOpenChange={setManualLinkModalOpen}
        onSave={handleManualLinkSave}
        onSaveHypothesis={handleHypothesisSave}
      />
    </div>
  );
}
