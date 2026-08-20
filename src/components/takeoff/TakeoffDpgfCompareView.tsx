"use client";

import dynamic from "next/dynamic";
import useSWR from "swr";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import { Button } from "@/components/ui-legacy/Button";
import { useToast } from "@/components/ui-legacy/Toast";
import { DpgfRowList } from "@/components/takeoff/takeoff-dpgf-compare-view/DpgfRowList";
import { ManualLinkModal } from "@/components/takeoff/takeoff-dpgf-compare-view/ManualLinkModal";
import { RiskRadarSummary } from "@/components/takeoff/takeoff-dpgf-compare-view/RiskRadarSummary";
import { RiskStatusModal } from "@/components/takeoff/takeoff-dpgf-compare-view/RiskStatusModal";
import { SelectedRowReviewAside } from "@/components/takeoff/takeoff-dpgf-compare-view/SelectedRowReviewAside";
import {
  DECISION_LABELS,
  RISK_STATUS_LABELS,
  STATUS_LABELS,
  STATUS_OPTIONS,
  SORT_OPTIONS,
  type ReviewStatusFilter,
  type SortKey,
} from "@/components/takeoff/takeoff-dpgf-compare-view/constants";
import { buildManualLinkCandidates } from "@/components/takeoff/takeoff-dpgf-compare-view/manualLinkCandidates";
import {
  buildProofGroups,
  buildSearchText,
  exportRowsAsCsv,
  sortRows,
} from "@/components/takeoff/takeoff-dpgf-compare-view/utils";
import {
  fetchTakeoffRiskRadar,
  isTakeoffApiError,
  saveTakeoffDpgfManualLink,
  saveTakeoffReviewDecision,
  updateTakeoffRiskAlertStatus,
} from "@/lib/takeoff/client";
import type {
  TakeoffDpgfComparisonResponse,
  TakeoffDpgfComparisonView,
  TakeoffDpgfReviewDecision,
  TakeoffRiskAlert,
  TakeoffRiskStatus,
} from "@/lib/takeoff/types";

type TakeoffDpgfCompareViewProps = {
  data: TakeoffDpgfComparisonResponse;
  currentView: TakeoffDpgfComparisonView;
  onViewChange: (view: TakeoffDpgfComparisonView) => void;
  onRefresh: () => void;
};

type RiskActionTarget = {
  alertId: string;
  status: Extract<TakeoffRiskStatus, "assumed" | "false_positive">;
  causeLabel: string;
  scopeLabel: string;
};

const TakeoffLineEvidencePanel = dynamic(
  () => import("@/components/takeoff/TakeoffLineEvidencePanel"),
  {
    ssr: false,
    loading: () => null,
  }
);

const PriceSuggestionPanel = dynamic(
  () =>
    import("@/components/takeoff/PriceSuggestionPanel").then((mod) => ({
      default: mod.PriceSuggestionPanel,
    })),
  {
    ssr: false,
    loading: () => null,
  }
);

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

export { buildManualLinkCandidates };

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
  const [evidencePanelOpen, setEvidencePanelOpen] = useState(false);
  const [priceSuggestionPanelOpen, setPriceSuggestionPanelOpen] = useState(false);
  const [manualLinkSaving, setManualLinkSaving] = useState(false);
  const [decisionReason, setDecisionReason] = useState("");
  const [draftDecision, setDraftDecision] = useState<TakeoffDpgfReviewDecision | null>(null);
  const [decisionSaving, setDecisionSaving] = useState(false);
  const [riskActionTarget, setRiskActionTarget] = useState<RiskActionTarget | null>(null);
  const [riskReviewNote, setRiskReviewNote] = useState("");
  const [riskStatusSaving, setRiskStatusSaving] = useState(false);
  const [isToolbarPending, startToolbarTransition] = useTransition();
  const {
    data: riskRadar,
    error: riskRadarError,
    isLoading: riskRadarLoading,
    mutate: mutateRiskRadar,
  } = useSWR(
    ["takeoff-risk-radar", data.job_id, data.version_id],
    () =>
      fetchTakeoffRiskRadar(data.job_id, {
        version_id: data.version_id,
      }),
    {
      revalidateOnFocus: true,
      keepPreviousData: true,
    }
  );

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

  useEffect(() => {
    if (!riskActionTarget) {
      setRiskReviewNote("");
      return;
    }

    setRiskReviewNote("");
  }, [riskActionTarget]);

  const exceptionCounts = useMemo(() => {
    const source = data.rows;
    return {
      significant_gap: source.filter((row) => row.review_status === "significant_gap").length,
      to_confirm: source.filter((row) => row.review_status === "to_confirm").length,
      unlinked: source.filter((row) => row.review_status === "unlinked").length,
    };
  }, [data.rows]);

  const proofGroups = useMemo(() => buildProofGroups(selectedRow), [selectedRow]);

  const openRiskItems = useMemo(
    () => (riskRadar?.items ?? []).filter((item) => item.status === "to_process"),
    [riskRadar]
  );

  const selectedLineRiskItems = useMemo(() => {
    if (!selectedRow) {
      return [] as TakeoffRiskAlert[];
    }

    return (riskRadar?.items ?? []).filter(
      (item) => item.scope_type === "line" && item.line_id === selectedRow.line_id
    );
  }, [riskRadar, selectedRow]);

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
      void mutateRiskRadar();
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
      void mutateRiskRadar();
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
      void mutateRiskRadar();
    } catch (error) {
      toast.error({
        title: "Impossible d'enregistrer la décision",
        description: isTakeoffApiError(error) ? error.message : "Erreur inconnue.",
      });
    } finally {
      setDecisionSaving(false);
    }
  };

  const handleRiskStatusSave = async () => {
    if (!riskActionTarget) {
      return;
    }

    setRiskStatusSaving(true);
    try {
      await updateTakeoffRiskAlertStatus(data.job_id, riskActionTarget.alertId, {
        version_id: data.version_id,
        status: riskActionTarget.status,
        review_note: riskReviewNote.trim(),
      });

      toast.success({
        title: "Statut de risque mis a jour",
        description: `${riskActionTarget.causeLabel} passe en ${RISK_STATUS_LABELS[riskActionTarget.status].toLocaleLowerCase("fr-FR")}.`,
      });
      setRiskActionTarget(null);
      onRefresh();
      void mutateRiskRadar();
    } catch (error) {
      toast.error({
        title: "Impossible de mettre a jour le risque",
        description: isTakeoffApiError(error) ? error.message : "Erreur inconnue.",
      });
    } finally {
      setRiskStatusSaving(false);
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
              onClick={() => exportRowsAsCsv(filteredRows, STATUS_LABELS)}
            >
              Export CSV
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <SummaryCard label="Fiables" value={data.summary.reliable_matches} accent="text-emerald-700" />
          <SummaryCard label="À confirmer" value={data.summary.to_confirm} accent="text-amber-700" />
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

      <RiskRadarSummary
        riskRadar={riskRadar}
        riskRadarError={riskRadarError}
        riskRadarLoading={riskRadarLoading}
        openRiskItems={openRiskItems}
        onOpenLine={(lineId) =>
          startTransition(() => {
            setSelectedRowId(lineId);
          })
        }
        onRiskAction={setRiskActionTarget}
      />

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
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                onRefresh();
                void mutateRiskRadar();
              }}
            >
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
              onClick={() => {
                startToolbarTransition(() => {
                  setStatusFilter(statusFilter === "significant_gap" ? "all" : "significant_gap");
                });
              }}
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
              onClick={() => {
                startToolbarTransition(() => {
                  setStatusFilter(statusFilter === "to_confirm" ? "all" : "to_confirm");
                });
              }}
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
              onClick={() => {
                startToolbarTransition(() => {
                  setStatusFilter(statusFilter === "unlinked" ? "all" : "unlinked");
                });
              }}
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
        <DpgfRowList
          filteredRows={filteredRows}
          selectedRowId={selectedRow?.line_id ?? null}
          onSelectRow={setSelectedRowId}
        />
        <SelectedRowReviewAside
          selectedRow={selectedRow}
          selectedLineRiskItems={selectedLineRiskItems}
          proofGroups={proofGroups}
          draftDecision={draftDecision}
          decisionReason={decisionReason}
          decisionSaving={decisionSaving}
          onDecisionSelect={setDraftDecision}
          onDecisionReasonChange={setDecisionReason}
          onDecisionSave={() => void handleDecisionSave()}
          onOpenManualLinkModal={() => setManualLinkModalOpen(true)}
          onOpenEvidencePanel={() => setEvidencePanelOpen(true)}
          onOpenPriceSuggestionPanel={() => setPriceSuggestionPanelOpen(true)}
          onRiskAction={setRiskActionTarget}
        />
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

      {selectedRow ? (
        <>
          <TakeoffLineEvidencePanel
            open={evidencePanelOpen}
            onOpenChange={setEvidencePanelOpen}
            jobId={data.job_id}
            versionId={data.version_id}
            lineId={selectedRow.dpgf.estimate_item_id}
            lineLabel={selectedRow.line_label}
            sourceFileName={selectedRow.dpgf.source_file_name}
            sourcePage={selectedRow.dpgf.source_page}
            surfaceLabel="Preuves persistantes"
          />
          <PriceSuggestionPanel
            open={priceSuggestionPanelOpen}
            onOpenChange={setPriceSuggestionPanelOpen}
            jobId={data.job_id}
            versionId={data.version_id}
            estimateItemId={selectedRow.dpgf.estimate_item_id}
            lineLabel={selectedRow.line_label}
            onReviewComplete={() => {
              onRefresh();
              void mutateRiskRadar();
            }}
          />
        </>
      ) : null}

      <RiskStatusModal
        riskActionTarget={riskActionTarget}
        riskReviewNote={riskReviewNote}
        riskStatusSaving={riskStatusSaving}
        onOpenChange={(open) => {
          if (!open) {
            setRiskActionTarget(null);
          }
        }}
        onRiskReviewNoteChange={setRiskReviewNote}
        onSave={() => void handleRiskStatusSave()}
      />
    </div>
  );
}
