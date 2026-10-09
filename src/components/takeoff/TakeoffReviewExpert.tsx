"use client";

import dynamic from "next/dynamic";

import type { ReviewItem } from "@/components/takeoff/TakeoffReviewPage";
import TakeoffReviewTable, {
  detectAnomalies,
} from "@/components/takeoff/TakeoffReviewTable";
import { TakeoffTableView } from "@/components/takeoff/TakeoffTableView";
import TakeoffDiffView from "@/components/takeoff/TakeoffDiffView";
import { EmptyState } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import type {
  TakeoffDpgfComparisonResponse,
  TakeoffDpgfComparisonView,
  TakeoffJobCompareResponse,
  TakeoffJobSummary,
  TakeoffTable,
} from "@/lib/takeoff/types";

const TakeoffDpgfCompareView = dynamic(
  () => import("@/components/takeoff/TakeoffDpgfCompareView"),
  {
    ssr: false,
    loading: () => (
      <LoadingState label="Chargement de la comparaison DPGF…" />
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
  dpgfCompareView: TakeoffDpgfComparisonView;
  dpgfCompareLoading: boolean;
  dpgfCompareError: string | null;
  onSetDpgfCompareView: (view: TakeoffDpgfComparisonView) => void;
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
    <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface-subtle px-4 py-3 text-sm">
      {tablesCount > 0 && (
        <span>
          <span className="font-medium text-foreground">{tablesCount}</span>{" "}
          <span className="text-muted-foreground">Tables</span>
        </span>
      )}
      <span>
        <span className="font-medium text-foreground">{total}</span>{" "}
        <span className="text-muted-foreground">Total</span>
      </span>
      <span>
        <span className="font-medium text-success">{included}</span>{" "}
        <span className="text-muted-foreground">Inclus</span>
      </span>
      <span>
        <span className="font-medium text-muted-foreground">{excluded}</span>{" "}
        <span className="text-muted-foreground">Exclus</span>
      </span>
      <span>
        <span className="font-medium text-info">{verified}</span>{" "}
        <span className="text-muted-foreground">Vérifiés</span>
      </span>
      <span>
        <span className="font-medium text-warning">{withAnomalies}</span>{" "}
        <span className="text-muted-foreground">Anomalies</span>
      </span>

      {/* Level C extras */}
      {isLevelC && (
        <>
          <span className="border-l border-border pl-4">
            <span className="font-medium text-foreground">{evidencePct}%</span>{" "}
            <span className="text-muted-foreground">Couverture preuve</span>
          </span>
          {lowConfidenceCount > 0 && (
            <span>
              <span className="font-medium text-danger">{lowConfidenceCount}</span>{" "}
              <span className="text-muted-foreground">Confiance faible</span>
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
  dpgfCompareView,
  dpgfCompareLoading,
  dpgfCompareError,
  onSetDpgfCompareView,
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
          role="tablist"
          aria-label="Vues de la revue"
          className="relative flex gap-1 overflow-x-auto border-b border-border"
        >
          {hasTables ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "tables"}
              className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "tables"
                  ? "border-b-2 border-info text-info"
                  : "text-muted-foreground hover:text-foreground-secondary"
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
            className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "items"
                ? "border-b-2 border-info text-info"
                : "text-muted-foreground hover:text-foreground-secondary"
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
              className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "compare"
                  ? "border-b-2 border-info text-info"
                  : "text-muted-foreground hover:text-foreground-secondary"
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
              className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === "dpgf"
                  ? "border-b-2 border-info text-info"
                  : "text-muted-foreground hover:text-foreground-secondary"
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
          <LoadingState
            className="rounded-lg border border-border bg-surface"
            label="Chargement de la comparaison DPGF vs métré…"
          />
        ) : dpgfCompareError ? (
          <Alert variant="danger">
            <AlertDescription>{dpgfCompareError}</AlertDescription>
          </Alert>
        ) : dpgfCompareData ? (
          <TakeoffDpgfCompareView
            data={dpgfCompareData}
            currentView={dpgfCompareView}
            onViewChange={onSetDpgfCompareView}
            onRefresh={onRefreshDpgfCompare}
          />
        ) : (
          <EmptyState
            variant="compact"
            title="Rien à comparer"
            description="Aucune ligne DPGF ou aucun item de métré disponible."
          />
        )
      ) : activeTab === "compare" ? (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="takeoff-compare-job-select">
                  Extraction à comparer
                </FieldLabel>
                <NativeSelect
                  id="takeoff-compare-job-select"
                  size="sm"
                  value={compareWithJobId ?? ""}
                  onChange={(event) => {
                    const nextValue = event.target.value.trim();
                    onSetCompareWithJobId(nextValue.length > 0 ? nextValue : null);
                  }}
                >
                  <option value="">Sélectionner une extraction</option>
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
                </NativeSelect>
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="takeoff-compare-threshold-select">
                  Seuil de similarité
                </FieldLabel>
                <NativeSelect
                  id="takeoff-compare-threshold-select"
                  size="sm"
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
                </NativeSelect>
              </div>
            </div>
          </Card>

          {compareLoading ? (
            <LoadingState
              className="rounded-lg border border-border bg-surface"
              label="Chargement de la comparaison…"
            />
          ) : compareError ? (
            <Alert variant="danger">
              <AlertDescription>{compareError}</AlertDescription>
            </Alert>
          ) : compareData ? (
            <TakeoffDiffView
              key={`${compareData.base_job_id}:${compareData.other_job_id}:${compareData.threshold}`}
              compare={compareData}
              onApplySelection={onApplyDiffSelection}
              isApplyingSelection={applySelectionSubmitting}
              applySelectionError={applySelectionError}
            />
          ) : (
            <EmptyState
              variant="compact"
              title="Aucune comparaison"
              description="Sélectionnez une autre extraction pour afficher les différences."
            />
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
