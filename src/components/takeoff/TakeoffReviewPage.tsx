"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import TakeoffReviewTable, {
  detectAnomalies,
  hasBlockingAnomaly,
} from "@/components/takeoff/TakeoffReviewTable";
import { TakeoffTableView } from "@/components/takeoff/TakeoffTableView";
import {
  TakeoffApplyWizard,
  type TakeoffApplyWizardSubmitPayload,
} from "@/components/takeoff/TakeoffApplyWizard";
import {
  applyTakeoffJob,
  fetchTakeoffJob,
  isTakeoffApiError,
  patchTakeoffItems,
} from "@/lib/takeoff/client";
import type {
  TakeoffItemPatchEntry,
  TakeoffJobItem,
  TakeoffTable,
} from "@/lib/takeoff/types";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type ReviewItem = TakeoffJobItem & {
  _dirty: boolean;
  _saving: boolean;
  _error: string | null;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TakeoffReviewPageProps = {
  jobId: string;
  versionId: string;
};

type ViewTab = "tables" | "items";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTO_SAVE_DEBOUNCE_MS = 500;
const REVIEW_ITEMS_PAGE_SIZE = 200;

// ---------------------------------------------------------------------------
// Exclusion reason modal
// ---------------------------------------------------------------------------

function ExclusionReasonModal({
  open,
  onOpenChange,
  count,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canConfirm = reason.trim().length > 0;

  useEffect(() => {
    if (!open) setReason("");
  }, [open]);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <Modal.Header>
          <Modal.Title>
            Exclure {count} item{count > 1 ? "s" : ""}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <label className="block text-sm font-medium text-[var(--slate-700)]">
            Motif d&apos;exclusion (obligatoire)
          </label>
          <textarea
            className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm focus:border-[var(--ring)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Indiquer le motif d'exclusion..."
            maxLength={500}
          />
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>Annuler</Modal.Close>
          <Button
            variant="danger"
            size="sm"
            disabled={!canConfirm}
            onClick={() => {
              onConfirm(reason.trim());
              onOpenChange(false);
            }}
          >
            Exclure
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

// ---------------------------------------------------------------------------
// Summary stats bar (enriched with tables count)
// ---------------------------------------------------------------------------

function SummaryStatsBar({
  items,
  tablesCount,
}: {
  items: ReviewItem[];
  tablesCount: number;
}) {
  const total = items.length;
  const included = items.filter((i) => !i.is_excluded).length;
  const excluded = items.filter((i) => i.is_excluded).length;
  const verified = items.filter((i) => i.is_verified).length;
  const withAnomalies = items.filter((i) => detectAnomalies(i).length > 0).length;

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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export default function TakeoffReviewPage({
  jobId,
  versionId,
}: TakeoffReviewPageProps) {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();

  // ---- Tab state from URL
  const viewParam = searchParams.get("view");
  const activeTab: ViewTab =
    viewParam === "tables" || viewParam === "items" ? viewParam : "items";

  const setActiveTab = useCallback(
    (tab: ViewTab) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("view", tab);
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams]
  );

  // ---- Data state
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [tables, setTables] = useState<TakeoffTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [jobFileName, setJobFileName] = useState<string | null>(null);
  const [jobLevel, setJobLevel] = useState<string | null>(null);

  // ---- Exclusion modal state
  const [exclusionModalOpen, setExclusionModalOpen] = useState(false);
  const [exclusionTargetIds, setExclusionTargetIds] = useState<string[]>([]);

  // ---- Apply wizard state
  const [applyWizardOpen, setApplyWizardOpen] = useState(false);
  const [applySubmitting, setApplySubmitting] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  // ---- Auto-save
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  // ---- Fetch data
  useEffect(() => {
    let canceled = false;
    const abortController = new AbortController();
    async function load() {
      try {
        setLoading(true);
        setLoadError(null);

        const firstPage = await fetchTakeoffJob(jobId, {
          signal: abortController.signal,
          itemsLimit: REVIEW_ITEMS_PAGE_SIZE,
          itemsOffset: 0,
        });
        if (canceled) return;

        const allItems: TakeoffJobItem[] = [...firstPage.items.data];
        const totalItems = firstPage.items.pagination.total;
        let nextOffset =
          firstPage.items.pagination.offset + firstPage.items.data.length;

        while (allItems.length < totalItems) {
          const page = await fetchTakeoffJob(jobId, {
            signal: abortController.signal,
            itemsLimit: REVIEW_ITEMS_PAGE_SIZE,
            itemsOffset: nextOffset,
          });
          if (canceled) return;
          if (page.items.data.length === 0) {
            break;
          }
          allItems.push(...page.items.data);
          nextOffset += page.items.data.length;
        }

        setJobFileName(firstPage.job.source_file_name);
        setJobLevel(firstPage.job.level);

        // Extract tables from result if available
        const resultTables = firstPage.result?.tables;
        if (Array.isArray(resultTables)) {
          setTables(resultTables as TakeoffTable[]);
        }

        setItems(
          allItems.map((item) => ({
            ...item,
            _dirty: false,
            _saving: false,
            _error: null,
          }))
        );

        // If Level B and tables exist, default to tables view
        if (
          firstPage.job.level === "B" &&
          Array.isArray(resultTables) &&
          resultTables.length > 0 &&
          !viewParam
        ) {
          setActiveTab("tables");
        }
      } catch (err) {
        if (canceled || abortController.signal.aborted) return;
        setLoadError(
          isTakeoffApiError(err) ? err.message : "Impossible de charger les items."
        );
      } finally {
        if (!canceled) setLoading(false);
      }
    }
    load();
    return () => {
      canceled = true;
      abortController.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  // ---- Item update helpers
  const updateItemField = useCallback(
    (itemId: string, field: string, value: unknown) => {
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== itemId) return item;
          return { ...item, [field]: value, _dirty: true, _error: null };
        })
      );
    },
    []
  );

  // ---- Auto-save logic
  const performSave = useCallback(async () => {
    if (savingRef.current) return;

    const dirtyItems = items.filter((i) => i._dirty && !i._saving);
    if (dirtyItems.length === 0) return;

    savingRef.current = true;

    // Mark saving
    setItems((prev) =>
      prev.map((item) =>
        item._dirty ? { ...item, _saving: true } : item
      )
    );

    const patchEntries: TakeoffItemPatchEntry[] = dirtyItems.map((item) => {
      const fields: TakeoffItemPatchEntry["fields"] = {};
      fields.designation = item.designation;
      fields.quantity = item.quantity;
      fields.unit = item.unit;
      fields.is_excluded = item.is_excluded;
      if (item.is_excluded) {
        fields.exclusion_reason = item.exclusion_reason;
      }
      fields.is_verified = item.is_verified;

      return {
        item_id: item.id,
        updated_at: item.updated_at,
        fields,
      };
    });

    try {
      const response = await patchTakeoffItems(jobId, { items: patchEntries });

      setItems((prev) =>
        prev.map((item) => {
          const result = response.results.find((r) => r.item_id === item.id);
          if (!result) return item;

          if (result.success && result.item) {
            return {
              ...result.item,
              _dirty: false,
              _saving: false,
              _error: null,
            };
          }

          return {
            ...item,
            _dirty: false,
            _saving: false,
            _error: result.error ?? "Erreur inconnue.",
          };
        })
      );

      if (response.failed > 0) {
        toast.warning({
          title: `${response.failed} item(s) non sauvegarde(s)`,
          description: "Verifiez les items en erreur.",
        });
      } else {
        toast.success({
          title: "Sauvegarde automatique",
          durationMs: 2000,
        });
      }
    } catch (err) {
      setItems((prev) =>
        prev.map((item) =>
          item._saving
            ? {
                ...item,
                _dirty: false,
                _saving: false,
                _error: "Echec de sauvegarde.",
              }
            : item
        )
      );
      toast.error({
        title: "Erreur de sauvegarde",
        description: isTakeoffApiError(err) ? err.message : "Erreur inconnue.",
      });
    } finally {
      savingRef.current = false;
    }
  }, [items, jobId, toast]);

  // Trigger auto-save debounce when items change
  const hasDirty = items.some((i) => i._dirty);
  useEffect(() => {
    if (!hasDirty) return;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      performSave();
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [hasDirty, performSave]);

  // ---- Exclusion actions (shared between views)
  const handleExcludeItems = useCallback(
    (itemIds: string[]) => {
      const includedIds = itemIds.filter((id) => {
        const item = items.find((i) => i.id === id);
        return item && !item.is_excluded;
      });
      if (includedIds.length === 0) return;
      setExclusionTargetIds(includedIds);
      setExclusionModalOpen(true);
    },
    [items]
  );

  const handleIncludeItems = useCallback(
    (itemIds: string[]) => {
      setItems((prev) =>
        prev.map((item) => {
          if (!itemIds.includes(item.id) || !item.is_excluded) return item;
          return {
            ...item,
            is_excluded: false,
            exclusion_reason: null,
            _dirty: true,
            _error: null,
          };
        })
      );
    },
    []
  );

  const handleExclusionConfirm = useCallback(
    (reason: string) => {
      setItems((prev) =>
        prev.map((item) => {
          if (!exclusionTargetIds.includes(item.id)) return item;
          return {
            ...item,
            is_excluded: true,
            exclusion_reason: reason,
            _dirty: true,
            _error: null,
          };
        })
      );
      setExclusionTargetIds([]);
    },
    [exclusionTargetIds]
  );

  // ---- Apply readiness
  const includedItems = items.filter((i) => !i.is_excluded);
  const hasIncluded = includedItems.length > 0;
  const hasDirtyOrSaving = items.some((i) => i._dirty || i._saving);
  const hasSaveErrors = items.some((i) => i._error !== null);
  const hasBlockingAnomalies = includedItems.some(hasBlockingAnomaly);
  const isApplyReady =
    hasIncluded && !hasDirtyOrSaving && !hasSaveErrors && !hasBlockingAnomalies;

  // ---- Apply handler
  const handleApplyConfirm = useCallback(
    async (payload: TakeoffApplyWizardSubmitPayload) => {
      setApplySubmitting(true);
      setApplyError(null);
      try {
        await applyTakeoffJob(jobId, {
          strategy: payload.strategy,
          target_section_id: payload.targetSectionId,
        });
        setApplyWizardOpen(false);
        toast.success({
          title: "Takeoff applique au devis",
          description: `${includedItems.length} item(s) appliques avec la strategie "${payload.strategy}".`,
        });
        router.push(`/dashboard/estimates/${versionId}/takeoff/${jobId}`);
      } catch (err) {
        setApplyError(
          isTakeoffApiError(err) ? err.message : "Erreur lors de l'application."
        );
      } finally {
        setApplySubmitting(false);
      }
    },
    [jobId, versionId, includedItems.length, toast, router]
  );

  // ---- Table count
  const tablesCount = tables.length;
  const hasTables = tablesCount > 0;

  // ---- Loading state
  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Review Takeoff</h1>
          <p className="page-description">Chargement...</p>
        </div>
        <div className="dashboard-card p-6">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-[var(--slate-200)]"
                style={{ width: `${60 + (i % 3) * 15}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ---- Error state
  if (loadError) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Review Takeoff</h1>
          <p className="page-description">{loadError}</p>
        </div>
        <div className="mt-4 flex gap-3">
          <Link
            href={`/dashboard/estimates/${versionId}/takeoff/${jobId}`}
            className="btn btn-secondary btn-sm"
          >
            Retour au job
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* ---- Page header ---- */}
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Review Takeoff</h1>
          <p className="page-description">
            {jobFileName ?? "Job"} &mdash;{" "}
            {hasTables && <>{tablesCount} tables, </>}
            {items.length} item(s) extraits
            {jobLevel && (
              <Badge variant="neutral" size="sm" className="ml-2">
                Niveau {jobLevel}
              </Badge>
            )}
          </p>
        </div>
        <Link
          href={`/dashboard/estimates/${versionId}/takeoff/${jobId}`}
          className="btn btn-secondary btn-sm"
        >
          Retour au job
        </Link>
      </div>

      {/* ---- Summary stats ---- */}
      <SummaryStatsBar items={items} tablesCount={tablesCount} />

      {/* ---- Tab bar ---- */}
      {hasTables && (
        <div className="flex gap-1 border-b border-[var(--border)]">
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "tables"
                ? "border-b-2 border-[var(--info)] text-[var(--info)]"
                : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
            }`}
            onClick={() => setActiveTab("tables")}
          >
            Tables
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "items"
                ? "border-b-2 border-[var(--info)] text-[var(--info)]"
                : "text-[var(--slate-500)] hover:text-[var(--slate-700)]"
            }`}
            onClick={() => setActiveTab("items")}
          >
            Items ({items.length})
          </button>
        </div>
      )}

      {/* ---- Content area ---- */}
      {activeTab === "tables" && hasTables ? (
        <TakeoffTableView
          tables={tables}
          items={items}
          onUpdateItem={updateItemField}
          onExcludeItems={handleExcludeItems}
          onIncludeItems={handleIncludeItems}
        />
      ) : (
        <TakeoffReviewTable
          items={items}
          onUpdateItem={updateItemField}
          onExcludeItems={handleExcludeItems}
          onIncludeItems={handleIncludeItems}
        />
      )}

      {/* ---- Apply readiness bar ---- */}
      <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white px-4 py-3">
        <div className="text-sm">
          {isApplyReady ? (
            <span className="flex items-center gap-2 text-[var(--success)]">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.06l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              Pret a appliquer ({includedItems.length} items)
            </span>
          ) : (
            <span className="flex items-center gap-2 text-[var(--slate-500)]">
              {!hasIncluded && "Aucun item inclus."}
              {hasIncluded && hasDirtyOrSaving && "Sauvegarde en cours..."}
              {hasIncluded &&
                !hasDirtyOrSaving &&
                !hasBlockingAnomalies &&
                hasSaveErrors &&
                "Des erreurs de sauvegarde persistent. Corrigez les lignes en erreur puis modifiez-les pour relancer la sauvegarde."}
              {hasIncluded && !hasDirtyOrSaving && hasBlockingAnomalies && (
                "Anomalies bloquantes sur les items inclus (designation vide ou quantite invalide)."
              )}
            </span>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!isApplyReady}
          onClick={() => setApplyWizardOpen(true)}
          title={
            isApplyReady
              ? "Appliquer les items au chiffrage"
              : "Resolves les problemes avant d'appliquer"
          }
        >
          Appliquer au chiffrage
        </Button>
      </div>

      {/* ---- Exclusion modal ---- */}
      <ExclusionReasonModal
        open={exclusionModalOpen}
        onOpenChange={setExclusionModalOpen}
        count={exclusionTargetIds.length}
        onConfirm={handleExclusionConfirm}
      />

      {/* ---- Apply wizard ---- */}
      <TakeoffApplyWizard
        open={applyWizardOpen}
        versionId={versionId}
        includedCount={includedItems.length}
        excludedCount={items.length - includedItems.length}
        isSubmitting={applySubmitting}
        submitError={applyError}
        onOpenChange={setApplyWizardOpen}
        onConfirm={handleApplyConfirm}
      />
    </div>
  );
}
