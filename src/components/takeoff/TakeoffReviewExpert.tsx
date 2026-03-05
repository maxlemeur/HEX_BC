"use client";

import dynamic from "next/dynamic";

import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import TakeoffReviewTable, {
  detectAnomalies,
} from "@/components/takeoff/TakeoffReviewTable";
import { TakeoffTableView } from "@/components/takeoff/TakeoffTableView";
import TakeoffDiffView from "@/components/takeoff/TakeoffDiffView";
import type {
  TakeoffDpgfComparisonResponse,
  TakeoffJobCompareResponse,
  TakeoffJobSummary,
  TakeoffTable,
} from "@/lib/takeoff/types";

const TakeoffDpgfCompareView = dynamic(
  () => import("@/components/takeoff/TakeoffDpgfCompareView"),
  {
    ssr: false,
    loading: () => (
      <div className="dashboard-card p-6 text-sm text-[var(--slate-600)]">
        Chargement de la comparaison DPGF...
      </div>
    ),
  }
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ViewTab = "tables" | "items" | "compare" | "dpgf";

export type TakeoffReviewExpertProps = {
  items: ReviewItem[];
  tables: TakeoffTable[];
  jobLevel: string | null;

  // Tab state
  activeTab: ViewTab;
  onSetActiveTab: (tab: ViewTab) => void;

  // Compare state
  compareCandidates: TakeoffJobSummary[];
  compareWithJobId: string | null;
  compareThreshold: number;
  compareData: TakeoffJobCompareResponse | null;
  compareLoading: boolean;
  compareError: string | null;
  onSetCompareWithJobId: (id: string | null) => void;
  onSetCompareThreshold: (threshold: number) => void;
  onApplyDiffSelection: (selectedBaseItemIds: string[]) => Promise<void>;
  applySelectionSubmitting: boolean;
  applySelectionError: string | null;

  // DPGF compare state
  dpgfCompareData: TakeoffDpgfComparisonResponse | null;
  dpgfCompareLoading: boolean;
  dpgfCompareError: string | null;
  onRefreshDpgfCompare: () => void;

  // Item handlers
  onUpdateItem: (itemId: string, field: string, value: unknown) => void;
  onExcludeItems: (itemIds: string[]) => void;
  onIncludeItems: (itemIds: string[]) => void;
  onSyncToItems: (itemIds: string[]) => void;
  onOpenEvidencePanel: (itemId: string) => void;
};

// ---------------------------------------------------------------------------
// Summary stats bar (private)
// ---------------------------------------------------------------------------

function SummaryStatsBar({
  items,
  tablesCount,
  jobLevel,
}: {
  items: ReviewItem[];
  tablesCount: number;
  jobLevel: string | null;
}) {
  const total = items.length;
  const included = items.filter((i) => !i.is_excluded).length;
  const excluded = items.filter((i) => i.is_excluded).length;
  const verified = items.filter((i) => i.is_verified).length;
  const withAnomalies = items.filter((i) => detectAnomalies(i).length > 0).length;

  // Level C extras
  const isLevelC = jobLevel === "C";
  const evidenceCount = isLevelC
    ? items.filter((i) => !!i.evidence).length
    : 0;
  const evidencePct = isLevelC && total > 0
    ? Math.round((evidenceCount / total) * 100)
    : 0;
  const lowConfidenceCount = isLevelC
    ? items.filter((i) => i.confidence !== null && i.confidence < 0.5).length
    : 0;

  return (
    <div className="flex flex-wrap gap-4 rounded-lg border border-[var(--border)] bg-[var(--slate-50)] px-4 py-3 text-sm">
      {tablesCount > 0 && (
        <span>
          <span className="font-medium text-[var(--slate-800)]">{tablesCount}</span>{" "}
          <span className="text-[var(--slate-500)]">Tables</span>
        </span>
      )}
      <span>
        <span className="font-medium text-[var(--slate-800)]">{total}</span>{" "}
        <span className="text-[var(--slate-500)]">Total</span>
      </span>
      <span>
        <span className="font-medium text-[var(--success)]">{included}</span>{" "}
        <span className="text-[var(--slate-500)]">Inclus</span>
      </span>
      <span>
        <span className="font-medium text-[var(--slate-500)]">{excluded}</span>{" "}
        <span className="text-[var(--slate-500)]">Exclus</span>
      </span>
      <span>
        <span className="font-medium text-[var(--info)]">{verified}</span>{" "}
        <span className="text-[var(--slate-500)]">Verifies</span>
      </span>
      <span>
        <span className="font-medium text-[var(--warning)]">{withAnomalies}</span>{" "}
        <span className="text-[var(--slate-500)]">Anomalies</span>
      </span>

      {/* Level C extras */}
      {isLevelC && (
        <>
          <span className="border-l border-[var(--border)] pl-4">
            <span className="font-medium text-[var(--slate-800)]">{evidencePct}%</span>{" "}
            <span className="text-[var(--slate-500)]">Couverture evidence</span>
          </span>
          {lowConfidenceCount > 0 && (
            <span>
              <span className="font-medium text-[var(--danger)]">{lowConfidenceCount}</span>{" "}
              <span className="text-[var(--slate-500)]">Confiance faible</span>
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expert view component
// ---------------------------------------------------------------------------

export function TakeoffReviewExpert({
  items,
  tables,
  jobLevel,
  activeTab,
  onSetActiveTab,
  compareCandidates,
  compareWithJobId,
  compareThreshold,
  compareData,
  compareLoading,
  compareError,
  onSetCompareWithJobId,
  onSetCompareThreshold,
  onApplyDiffSelection,
  applySelectionSubmitting,
  applySelectionError,
  dpgfCompareData,
  dpgfCompareLoading,
  dpgfCompareError,
  onRefreshDpgfCompare,
  onUpdateItem,
  onExcludeItems,
  onIncludeItems,
  onSyncToItems,
  onOpenEvidencePanel,
}: TakeoffReviewExpertProps) {
  const tablesCount = tables.length;
  const hasTables = tablesCount > 0;
  const hasCompareTab = compareCandidates.length > 0 || compareWithJobId !== null;
  const hasDpgfTab = true;
  const selectedCompareCandidate =
    compareCandidates.find((job) => job.id === compareWithJobId) ?? null;

  return (
    <>
      {/* ---- Summary stats ---- */}
      <SummaryStatsBar items={items} tablesCount={tablesCount} jobLevel={jobLevel} />

      {/* ---- Tab bar ---- */}
      {(hasTables || hasCompareTab || hasDpgfTab) && (
        <div
          className="flex gap-1 border-b border-[var(--border)]"
          role="tablist"
          aria-label="Vues de review"
        >
          {hasTables ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "tables"}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "tables"
                  ? "border-b-2 border-[var(--info)] text-[var(--info)]"
                  : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
              }`}
              onClick={() => onSetActiveTab("tables")}
            >
              Tables
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "items"}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "items"
                ? "border-b-2 border-[var(--info)] text-[var(--info)]"
                : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
            }`}
            onClick={() => onSetActiveTab("items")}
          >
            Items ({items.length})
          </button>
          {hasCompareTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "compare"}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "compare"
                  ? "border-b-2 border-[var(--info)] text-[var(--info)]"
                  : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
              }`}
              onClick={() => onSetActiveTab("compare")}
            >
              Comparaison
            </button>
          ) : null}
          {hasDpgfTab ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "dpgf"}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "dpgf"
                  ? "border-b-2 border-[var(--info)] text-[var(--info)]"
                  : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
              }`}
              onClick={() => onSetActiveTab("dpgf")}
            >
              Comparaison DPGF
            </button>
          ) : null}
        </div>
      )}

      {/* ---- Content area ---- */}
      {activeTab === "dpgf" ? (
        dpgfCompareLoading ? (
          <section className="dashboard-card p-6 text-sm text-[var(--slate-600)]">
            Chargement de la comparaison DPGF vs Takeoff...
          </section>
        ) : dpgfCompareError ? (
          <section className="dashboard-card p-6 text-sm text-[var(--danger)]">
            {dpgfCompareError}
          </section>
        ) : dpgfCompareData ? (
          <TakeoffDpgfCompareView
            data={dpgfCompareData}
            onRefresh={onRefreshDpgfCompare}
          />
        ) : (
          <section className="dashboard-card p-6 text-sm text-[var(--slate-600)]">
            Aucune ligne DPGF ou aucun item takeoff disponible.
          </section>
        )
      ) : activeTab === "compare" ? (
        <div className="space-y-4">
          <section className="dashboard-card p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label
                  className="form-label"
                  htmlFor="takeoff-compare-job-select"
                >
                  Extraction à comparer
                </label>
                <select
                  id="takeoff-compare-job-select"
                  className="form-input form-select form-input--sm"
                  value={compareWithJobId ?? ""}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    onSetCompareWithJobId(nextValue.length > 0 ? nextValue : null);
                  }}
                >
                  <option value="">Selectionner une extraction</option>
                  {selectedCompareCandidate === null && compareWithJobId ? (
                    <option value={compareWithJobId}>
                      Extraction {compareWithJobId}
                    </option>
                  ) : null}
                  {compareCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.source_file_name ?? "Fichier inconnu"} ·{" "}
                      {new Date(candidate.created_at).toLocaleString("fr-FR")} ·{" "}
                      {candidate.status}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  className="form-label"
                  htmlFor="takeoff-compare-threshold-select"
                >
                  Seuil fuzzy
                </label>
                <select
                  id="takeoff-compare-threshold-select"
                  className="form-input form-select form-input--sm"
                  value={String(compareThreshold)}
                  onChange={(event) => {
                    const nextValue = Number(event.target.value);
                    if (!Number.isFinite(nextValue)) return;
                    onSetCompareThreshold(nextValue);
                  }}
                >
                  <option value="0.7">0.70</option>
                  <option value="0.75">0.75</option>
                  <option value="0.8">0.80</option>
                  <option value="0.85">0.85</option>
                  <option value="0.9">0.90</option>
                </select>
              </div>
            </div>
          </section>

          {compareLoading ? (
            <section className="dashboard-card p-6 text-sm text-[var(--slate-600)]">
              Chargement de la comparaison...
            </section>
          ) : compareError ? (
            <section className="dashboard-card p-6 text-sm text-[var(--danger)]">
              {compareError}
            </section>
          ) : compareData ? (
            <TakeoffDiffView
              key={`${compareData.base_job_id}:${compareData.other_job_id}:${compareData.threshold}`}
              compare={compareData}
              onApplySelection={onApplyDiffSelection}
              isApplyingSelection={applySelectionSubmitting}
              applySelectionError={applySelectionError}
            />
          ) : (
            <section className="dashboard-card p-6 text-sm text-[var(--slate-600)]">
              Selectionnez une autre extraction pour afficher le diff.
            </section>
          )}
        </div>
      ) : activeTab === "tables" && hasTables ? (
        <TakeoffTableView
          tables={tables}
          items={items}
          onUpdateItem={onUpdateItem}
          onExcludeItems={onExcludeItems}
          onIncludeItems={onIncludeItems}
          onSyncToItems={onSyncToItems}
        />
      ) : (
        <TakeoffReviewTable
          items={items}
          onUpdateItem={onUpdateItem}
          onExcludeItems={onExcludeItems}
          onIncludeItems={onIncludeItems}
          onOpenEvidencePanel={onOpenEvidencePanel}
        />
      )}
    </>
  );
}
