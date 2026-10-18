"use client";

import { useCallback, useMemo, useState } from "react";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import type {
  EstimateQualityFlagCounts,
  EstimateQualityFlagsByItemId,
} from "@/lib/estimate-quality";
import {
  buildEstimateExportFilename,
  buildEstimateLineExportRows,
  buildEstimateRecapRow,
  getEstimateLineExportColumns,
  normalizeSupplierComparisonsByItemId,
  type SupplierComparisonAlternative,
  type SupplierComparisonsByItemId,
} from "@/lib/estimates/editor-export";
import type {
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import {
  exportEstimate,
  type EstimateExportMode,
} from "@/lib/estimates/client";

type ActiveEstimateExportMode = EstimateExportMode | "csv";

export type EstimateEditorExportController = {
  state: {
    isExporting: boolean;
    activeMode: ActiveEstimateExportMode | null;
  };
  actions: {
    exportExcel: () => Promise<void>;
    exportCsv: () => Promise<void>;
    exportDpgf: () => Promise<void>;
    exportBdc: () => Promise<void>;
  };
  meta: {
    /** Excel, DPGF et BDC (GET /api/estimates/{id}/export). */
    isStreamingDisabled: boolean;
    /**
     * CSV : construit par le client (editor-export.ts) pour une v1/v2, ce qui exige les réglages et les totaux ;
     * écrit par le serveur depuis le document pour une v3 (GET …/export?format=csv, sous-lot 2.7b), comme Excel.
     */
    isCsvDisabled: boolean;
    loadingLabel: string;
  };
};

export function useEstimateEditorExportController(input: {
  versionId: string;
  projectName: string;
  version: EstimateVersionRow | null;
  settings: EstimateSettingsState | null;
  totals: EstimateTotals | null;
  items: EstimateItem[];
  supplyTypeById: ReadonlyMap<string, { name: string }>;
  laborRoleById: ReadonlyMap<string, { name: string }>;
  qualityFlagsByItemId: EstimateQualityFlagsByItemId;
  qualityCounts: EstimateQualityFlagCounts;
  isLaborSplitEnabled: boolean;
  /** Moteur 3 : CSV écrit par le serveur depuis le document v3, jamais recalculé dans le navigateur. */
  isV3?: boolean;
  reportError: (message: string) => void;
  resolveErrorMessage: (message: string) => string;
}): EstimateEditorExportController {
  const {
    versionId,
    projectName,
    version,
    settings,
    totals,
    items,
    supplyTypeById,
    laborRoleById,
    qualityFlagsByItemId,
    qualityCounts,
    isLaborSplitEnabled,
    isV3 = false,
    reportError,
    resolveErrorMessage,
  } = input;
  const [isExporting, setIsExporting] = useState(false);
  const [activeMode, setActiveMode] =
    useState<ActiveEstimateExportMode | null>(null);

  const fetchSupplierComparisonsByItemId = useCallback(async () => {
    const lineItemIds = Array.from(
      new Set(
        items
          .filter((item) => item.item_type === "line")
          .map((item) => item.id)
      )
    );

    if (!versionId || lineItemIds.length === 0) {
      return new Map<string, SupplierComparisonAlternative[]>();
    }

    const requestChunkSize = 200;
    const resultMap: SupplierComparisonsByItemId = new Map();
    let hadRequestError = false;

    for (
      let startIndex = 0;
      startIndex < lineItemIds.length;
      startIndex += requestChunkSize
    ) {
      const chunk = lineItemIds.slice(
        startIndex,
        startIndex + requestChunkSize
      );

      try {
        const response = await fetch(
          `/api/estimates/${versionId}/supplier-comparisons`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              item_ids: chunk,
            }),
          }
        );

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          hadRequestError = true;
          console.error(
            "Erreur lors du chargement des comparaisons fournisseur pour l'export.",
            {
              status: response.status,
              payload,
              chunk_size: chunk.length,
            }
          );
          continue;
        }

        const chunkMap = normalizeSupplierComparisonsByItemId(payload);
        chunkMap.forEach((alternatives, itemId) => {
          resultMap.set(itemId, alternatives);
        });
      } catch (error) {
        hadRequestError = true;
        console.error(
          "Erreur lors du chargement des comparaisons fournisseur pour l'export.",
          error
        );
      }
    }

    if (hadRequestError) {
      reportError(
        "Certaines comparaisons fournisseurs n'ont pas pu être chargees pour l'export."
      );
    }

    return resultMap;
  }, [items, reportError, versionId]);

  const runStreamingExport = useCallback(
    async (options: {
      mode: EstimateExportMode;
      includeModeQueryParam: boolean;
      logMessage: string;
      fallbackMessage: string;
      /** CSV d'une v3 : même route, format csv (sous-lot 2.7b). */
      csv?: boolean;
    }) => {
      if (isExporting || !versionId) return;

      setIsExporting(true);
      setActiveMode(options.csv ? "csv" : options.mode);
      try {
        if (options.csv) {
          await exportEstimate(versionId, "csv");
        } else if (options.includeModeQueryParam) {
          await exportEstimate(versionId, "xlsx", {
            mode: options.mode,
          });
        } else {
          await exportEstimate(versionId, "xlsx");
        }
      } catch (error) {
        console.error(options.logMessage, error);
        reportError(
          resolveErrorMessage(
            error instanceof Error ? error.message : options.fallbackMessage
          )
        );
      } finally {
        setIsExporting(false);
        setActiveMode(null);
      }
    },
    [
      reportError,
      resolveErrorMessage,
      versionId,
      isExporting,
    ]
  );

  const exportExcel = useCallback(async () => {
    await runStreamingExport({
      mode: "standard",
      includeModeQueryParam: false,
      logMessage: "Erreur lors de l'export Excel streaming.",
      fallbackMessage: "Impossible d'exporter le devis en Excel.",
    });
  }, [runStreamingExport]);

  const exportDpgf = useCallback(async () => {
    await runStreamingExport({
      mode: "dpgf",
      includeModeQueryParam: true,
      logMessage: "Erreur lors de l'export DPGF streaming.",
      fallbackMessage: "Impossible d'exporter le DPGF.",
    });
  }, [runStreamingExport]);

  const exportBdc = useCallback(async () => {
    await runStreamingExport({
      mode: "bdc",
      includeModeQueryParam: true,
      logMessage: "Erreur lors de l'export BDC V1.1 streaming.",
      fallbackMessage: "Impossible d'exporter le BDC V1.1.",
    });
  }, [runStreamingExport]);

  const exportCsv = useCallback(async () => {
    if (isExporting) return;
    if (isV3) {
      // v3 : les totaux du client sont nuls ; le serveur écrit le CSV depuis le document v3 (sous-lot 2.7b).
      await runStreamingExport({
        mode: "standard",
        includeModeQueryParam: false,
        logMessage: "Erreur lors de l'export CSV v3.",
        fallbackMessage: "Impossible d'exporter le devis en CSV.",
        csv: true,
      });
      return;
    }

    const recapRow = buildEstimateRecapRow({
      projectName,
      version,
      settings,
      totals,
      qualityCounts,
    });
    if (!recapRow) return;

    setIsExporting(true);
    setActiveMode("csv");
    try {
      const supplierComparisonsByItemId =
        await fetchSupplierComparisonsByItemId();
      const lines = buildEstimateLineExportRows({
        items,
        currency: settings?.currency ?? "EUR",
        supplyTypeById,
        laborRoleById,
        qualityFlagsByItemId,
        supplierComparisonsByItemId,
      });
      const filename = buildEstimateExportFilename({
        projectName,
        versionNumber: version?.version_number,
      });
      const { exportToCSV } = await import("@/lib/export");
      await exportToCSV(
        lines,
        getEstimateLineExportColumns(isLaborSplitEnabled),
        { filename }
      );
    } catch (error) {
      console.error("Erreur lors de l'export CSV.", error);
    } finally {
      setIsExporting(false);
      setActiveMode(null);
    }
  }, [
    fetchSupplierComparisonsByItemId,
    isLaborSplitEnabled,
    isV3,
    items,
    laborRoleById,
    projectName,
    qualityCounts,
    qualityFlagsByItemId,
    settings,
    runStreamingExport,
    supplyTypeById,
    totals,
    version,
    isExporting,
  ]);

  const state = useMemo(
    () => ({ isExporting, activeMode }),
    [activeMode, isExporting]
  );
  const actions = useMemo(
    () => ({ exportExcel, exportCsv, exportDpgf, exportBdc }),
    [exportBdc, exportCsv, exportDpgf, exportExcel]
  );

  let loadingLabel = "Export XLSX...";
  if (activeMode === "dpgf") {
    loadingLabel = "Export DPGF...";
  } else if (activeMode === "bdc") {
    loadingLabel = "Export BDC V1.1...";
  } else if (activeMode === "csv") {
    loadingLabel = "Export CSV...";
  }

  // Excel, DPGF et BDC sont produits par GET /api/estimates/{id}/export : ils
  // n'ont pas besoin des totaux du client (nuls sur une v3). Le CSV d'une
  // v1/v2, construit ici (editor-export.ts), les exige ; celui d'une v3 vient
  // de la même route (format csv) et suit donc le drapeau du streaming.
  const meta = useMemo(
    () => ({
      isStreamingDisabled: isExporting || !version,
      isCsvDisabled: isV3
        ? isExporting || !version
        : isExporting || !version || !settings || !totals,
      loadingLabel,
    }),
    [isExporting, isV3, loadingLabel, settings, totals, version]
  );

  return useMemo(
    () => ({ state, actions, meta }),
    [actions, meta, state]
  );
}
