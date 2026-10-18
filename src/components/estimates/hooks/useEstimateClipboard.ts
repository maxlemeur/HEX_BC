"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

import {
  CLIPBOARD_MAPPING_TARGETS,
  DEFAULT_CLIPBOARD_FIELD_ORDER,
  buildClipboardPreviewRows,
  detectClipboardFormat,
  parseTsvMatrix,
  serializeSelectedRowsToTsv,
  suggestClipboardColumnMapping,
  type ClipboardColumnMapping,
  type ClipboardFormat,
  type ClipboardPreviewRow,
  type ClipboardPreviewValues,
  type ClipboardMappingTarget,
  type ClipboardTsvMatrix,
} from "@/lib/estimates/clipboard";
import {
  interpretClipboardRowForV3,
  isClipboardSheetParameterRow,
  readClipboardSheetMajoration,
  readClipboardSheetRates,
  resolveV3PasteLaborRole,
  v3ClipboardUnit,
  V3_CLIPBOARD_FIELD_ORDER,
} from "@/lib/estimates/v3-paste";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

type PastePreviewDialogRow = {
  id: string;
  rowNumber: number;
  include: boolean;
  values: Record<string, string | number | boolean | null>;
  invalidReasons: string[];
  /** v3 (sous-lot 2.8, règle 2) : valeurs interprétées qui seront écrites. */
  interpretation?: string[];
};

/** Choix du rôle MO d'un collage v3 : « aucun rôle » (MO à 0 €/h) se distingue de l'absence de choix. */
export const PASTE_NO_LABOR_ROLE = "__none__";

export type PasteLaborRoleField = {
  value: string;
  options: Array<{ value: string; label: string }>;
  message: string | null;
  blocking: boolean;
};

type UseEstimateClipboardParams = {
  isReadOnly: boolean;
  tableCardRef: RefObject<HTMLDivElement | null>;
  insertionAnchorItemIdRef: RefObject<string | null>;
  items: EstimateItem[];
  selectedLineIdList: string[];
  hasSelectedLines: boolean;
  mergedUnitDrafts: Record<string, string>;
  supplyTypeById: Map<string, SupplyType>;
  /** Sous-lot 2.8, règle 2 : sur une v3, les rôles MO dont l'un, actif, est choisi pour les lignes collées. */
  v3LaborRoles?: readonly LaborRole[] | null;
  onPasteRows: (input: {
    anchorRowId: string | null;
    rows: ClipboardPreviewValues[];
    laborRoleId?: string | null;
  }) => Promise<void>;
};

const CLIPBOARD_TARGET_FIELD_LABELS: Record<ClipboardMappingTarget, string> = {
  designation: "Désignation",
  quantity: "Quantité",
  unit: "Unité",
  unit_price_ht: "Prix unitaire HT",
  supply_type: "Type FO",
  k_fo: "K FO",
  h_mo: "h MO",
  k_mo: "K MO",
  // D11 (2.3 review): an undeclared majoration unit is chosen here, explicitly.
  h_mo_majoration: "Majoration MO (unité de l’en-tête)",
  h_mo_majoration_percent: "Majoration MO (%), 100 = neutre",
  h_mo_majoration_coefficient: "Majoration MO (coefficient), 1 = neutre",
  h_mo_majoration_additive: "Majoration MO (additive OPTIMA), 0 = neutre",
  // Sub-lot 2.8: OPTIMA « Tps pose unitaire » (h/u × Q on a v1/v2) and the « Prix Unitaire » control.
  h_mo_per_unit: "Heures MO par unité (h/u)",
  control_unit_price: "Prix Unitaire (contrôle, non collé)",
  // Sub-lot 2.8: OPTIMA « Taux horaire », the rate that chooses the labour role of a v3 paste.
  hourly_rate: "Taux horaire (non collé ; choisit le rôle MO d’un devis au moteur 3)",
};

function isTextEditingTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  if (target instanceof HTMLInputElement) {
    return true;
  }

  if (target instanceof HTMLElement && target.isContentEditable) {
    return true;
  }

  return Boolean(
    target.closest(
      "[contenteditable=''],[contenteditable='true'],[contenteditable='plaintext-only']"
    )
  );
}

export function useEstimateClipboard({
  isReadOnly,
  tableCardRef,
  insertionAnchorItemIdRef,
  items,
  selectedLineIdList,
  hasSelectedLines,
  mergedUnitDrafts,
  supplyTypeById,
  v3LaborRoles = null,
  onPasteRows,
}: UseEstimateClipboardParams) {
  const [pasteMatrix, setPasteMatrix] = useState<ClipboardTsvMatrix | null>(null);
  const [pasteMapping, setPasteMapping] = useState<ClipboardColumnMapping>({});
  const [pastePreviewRows, setPastePreviewRows] = useState<ClipboardPreviewRow[]>([]);
  const [pasteIncludedByLineNumber, setPasteIncludedByLineNumber] = useState<
    Record<number, boolean>
  >({});
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const [isPastePreviewOpen, setIsPastePreviewOpen] = useState(false);
  const [isPastingRows, setIsPastingRows] = useState(false);
  const [pasteAnchorRowId, setPasteAnchorRowId] = useState<string | null>(null);
  const [detectedClipboardFormat, setDetectedClipboardFormat] =
    useState<ClipboardFormat>("generic");
  // undefined : pas de choix (règle de l'import) ; null : « aucun rôle » ; sinon le rôle choisi.
  const [pasteLaborRoleChoice, setPasteLaborRoleChoice] = useState<string | null | undefined>(undefined);
  const v3Paste = useMemo(() => v3LaborRoles
    ? { laborRoles: v3LaborRoles.filter((role) => role.is_active)
      .map((role) => ({ id: role.id, name: role.name, hourlyRateCents: role.hourly_rate_cents })) }
    : null, [v3LaborRoles]);
  const isV3Paste = v3Paste !== null;
  // Une ligne collée sur une v3 n'est écrite que si son unité et ses heures se lisent en saisies v3.
  const isPasteableRow = useCallback(
    (row: ClipboardPreviewRow) => row.status === "valid" && (!isV3Paste || interpretClipboardRowForV3(row.values).ok),
    [isV3Paste]
  );

  const clipboardTargetOptions = useMemo(() => {
    return CLIPBOARD_MAPPING_TARGETS.map((field) => ({
      value: field,
      label: CLIPBOARD_TARGET_FIELD_LABELS[field],
      required: field === "designation",
    }));
  }, []);

  const pasteMappingEntries = useMemo(() => {
    if (!pasteMatrix) return [];

    return pasteMatrix.headers.map((sourceColumn) => ({
      sourceColumn,
      targetField: pasteMapping[sourceColumn] ?? null,
      targetOptions: clipboardTargetOptions,
    }));
  }, [clipboardTargetOptions, pasteMapping, pasteMatrix]);

  const pasteDialogRows = useMemo<PastePreviewDialogRow[]>(() => {
    return pastePreviewRows.map((row, index) => {
      const rowId = `${row.lineNumber}-${index}`;
      const include =
        pasteIncludedByLineNumber[row.lineNumber] ?? isPasteableRow(row);
      const v3 = isV3Paste ? interpretClipboardRowForV3(row.values) : null;

      return {
        id: rowId,
        rowNumber: row.lineNumber,
        include,
        values: row.rawValues,
        invalidReasons: v3 && !v3.ok ? [...row.reasons, ...v3.reasons] : row.reasons,
        // Valeurs écrites : lignes valides, et la ligne de paramètres de la feuille (taux, majoration).
        ...(v3 ? { interpretation: row.status === "valid" || isClipboardSheetParameterRow(row.values) ? v3.notes : [] } : {}),
      };
    });
  }, [isPasteableRow, isV3Paste, pasteIncludedByLineNumber, pastePreviewRows]);

  const includedPasteValues = useMemo(
    () => pastePreviewRows
      .filter((row) => (pasteIncludedByLineNumber[row.lineNumber] ?? isPasteableRow(row)) && isPasteableRow(row))
      .map((row) => row.values),
    [isPasteableRow, pasteIncludedByLineNumber, pastePreviewRows]
  );

  const pasteLaborRoleResolution = useMemo(
    () => v3Paste
      ? resolveV3PasteLaborRole({
        rows: includedPasteValues, roles: v3Paste.laborRoles, requestedRoleId: pasteLaborRoleChoice,
        sheetRates: readClipboardSheetRates(pastePreviewRows.map((row) => row.values)),
      })
      : null,
    [includedPasteValues, pasteLaborRoleChoice, pastePreviewRows, v3Paste]
  );

  const pasteLaborRoleField = useMemo<PasteLaborRoleField | null>(() => {
    if (!v3Paste || !pasteLaborRoleResolution || pasteLaborRoleResolution.status === "not_needed") return null;
    const formatRate = (cents: number) =>
      new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
    const options = [
      ...v3Paste.laborRoles.map((role) => ({ value: role.id, label: `${role.name} (${formatRate(role.hourlyRateCents)}/h)` })),
      { value: PASTE_NO_LABOR_ROLE, label: "Aucun rôle (MO à 0 €/h)" },
    ];
    switch (pasteLaborRoleResolution.status) {
      case "resolved":
        return {
          value: pasteLaborRoleResolution.role.id, options, blocking: false,
          message: pasteLaborRoleResolution.origin === "workbook_rate"
            ? "Rôle au taux horaire collé, modifiable." : null,
        };
      case "declined":
        return { value: PASTE_NO_LABOR_ROLE, options, blocking: false, message: "Heures collées valorisées à 0 €/h." };
      case "unassigned":
        return {
          value: PASTE_NO_LABOR_ROLE, options, blocking: false,
          message: "Aucun taux horaire collé : MO à 0 €/h tant qu’aucun rôle n’est choisi.",
        };
      default:
        return {
          value: "", options: [{ value: "", label: "Choisir un rôle" }, ...options], blocking: true,
          message: "Choisissez le rôle MO des lignes collées : aucun rôle unique au taux horaire collé.",
        };
    }
  }, [pasteLaborRoleResolution, v3Paste]);

  const handlePasteLaborRoleChange = useCallback((value: string) => {
    setPasteLaborRoleChoice(value === PASTE_NO_LABOR_ROLE ? null : value === "" ? undefined : value);
  }, []);

  const detectedClipboardFormatForDialog = useMemo<"bdc" | "optima" | "generic">(() => {
    if (detectedClipboardFormat === "bdc_v1_1") return "bdc";
    if (detectedClipboardFormat === "optima") return "optima";
    return "generic";
  }, [detectedClipboardFormat]);

  const openPastePreviewFromText = useCallback((rawText: string) => {
    const matrix = parseTsvMatrix(rawText);
    const errors: string[] = [];

    if (matrix.headers.length === 0 || matrix.rows.length === 0) {
      errors.push("Aucune ligne exploitable détectée dans le presse-papier.");
    }

    const detectedFormat =
      matrix.headers.length > 0 ? detectClipboardFormat(matrix.headers) : "generic";
    const suggestedMapping = suggestClipboardColumnMapping(matrix.headers);
    const preview = buildClipboardPreviewRows(matrix, suggestedMapping);

    setDetectedClipboardFormat(detectedFormat);
    setPasteMatrix(matrix);
    setPasteMapping(suggestedMapping);
    setPastePreviewRows(preview.rows);
    setPasteErrors(errors);
    setPasteAnchorRowId(insertionAnchorItemIdRef.current);
    setPasteLaborRoleChoice(undefined);
    setPasteIncludedByLineNumber(() => {
      const initial: Record<number, boolean> = {};
      preview.rows.forEach((row) => {
        initial[row.lineNumber] = isPasteableRow(row);
      });
      return initial;
    });
    setIsPastePreviewOpen(true);
  }, [insertionAnchorItemIdRef, isPasteableRow]);

  const handlePasteMappingChange = useCallback(
    (sourceColumn: string, targetField: string | null) => {
      if (!pasteMatrix) return;

      setPasteMapping((previous) => {
        const next: ClipboardColumnMapping = { ...previous };
        if (!targetField) {
          delete next[sourceColumn];
        } else if (CLIPBOARD_MAPPING_TARGETS.includes(targetField as ClipboardMappingTarget)) {
          next[sourceColumn] = targetField as ClipboardMappingTarget;
        }

        const preview = buildClipboardPreviewRows(pasteMatrix, next);
        // v3 : une ligne que la nouvelle association rend écrivable (ou non) est incluse (ou exclue) d'office ;
        // un choix manuel sur une ligne dont l'état ne change pas est gardé. v1/v2 : inchangé.
        const wasPasteable = new Map(pastePreviewRows.map((row) => [row.lineNumber, isPasteableRow(row)]));
        setPastePreviewRows(preview.rows);
        setPasteIncludedByLineNumber((previousInclude) => {
          const merged: Record<number, boolean> = {};
          preview.rows.forEach((row) => {
            const existing = previousInclude[row.lineNumber];
            const pasteable = isPasteableRow(row);
            merged[row.lineNumber] = isV3Paste && wasPasteable.get(row.lineNumber) !== pasteable
              ? pasteable
              : existing !== undefined ? existing : pasteable;
          });
          return merged;
        });
        return next;
      });
    },
    [isPasteableRow, isV3Paste, pasteMatrix, pastePreviewRows]
  );

  const handleTogglePasteRow = useCallback((rowId: string, include: boolean) => {
    const lineNumber = Number.parseInt(rowId.split("-")[0] ?? "", 10);
    if (!Number.isFinite(lineNumber)) return;

    setPasteIncludedByLineNumber((previous) => ({
      ...previous,
      [lineNumber]: include,
    }));
  }, []);

  const closePastePreview = useCallback(() => {
    setIsPastePreviewOpen(false);
    setIsPastingRows(false);
    setPasteErrors([]);
    setPasteAnchorRowId(null);
    setPasteLaborRoleChoice(undefined);
  }, []);

  const handleConfirmPastePreview = useCallback(async () => {
    if (isReadOnly || isPastingRows) return;

    const selectedRows = pastePreviewRows.filter((row) => {
      const include = pasteIncludedByLineNumber[row.lineNumber] ?? isPasteableRow(row);
      return include && isPasteableRow(row) && Boolean(row.values.designation);
    });

    if (selectedRows.length === 0) {
      setPasteErrors(["Aucune ligne valide sélectionnée pour insertion."]);
      return;
    }
    if (pasteLaborRoleField?.blocking) {
      setPasteErrors([pasteLaborRoleField.message ?? "Choisissez le rôle MO des lignes collées."]);
      return;
    }

    setIsPastingRows(true);
    setPasteErrors([]);

    try {
      // v3 : la majoration de la ligne de paramètres (N2) vaut pour les lignes sans majoration, comme à l'import.
      const sheetMajoration = isV3Paste ? readClipboardSheetMajoration(pastePreviewRows.map((row) => row.values)) : null;
      await onPasteRows({
        anchorRowId: pasteAnchorRowId,
        rows: selectedRows.map((row) => sheetMajoration !== null && row.values.h_mo_majoration === null
          ? { ...row.values, h_mo_majoration: sheetMajoration } : row.values),
        ...(isV3Paste ? { laborRoleId: pasteLaborRoleResolution?.role?.id ?? null } : {}),
      });
      closePastePreview();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible d'insérer les lignes collées.";
      setPasteErrors([message]);
    } finally {
      setIsPastingRows(false);
    }
  }, [
    closePastePreview,
    isPasteableRow,
    isPastingRows,
    isReadOnly,
    isV3Paste,
    onPasteRows,
    pasteAnchorRowId,
    pasteIncludedByLineNumber,
    pasteLaborRoleField,
    pasteLaborRoleResolution,
    pastePreviewRows,
  ]);

  const copySelectedRowsToClipboard = useCallback(async () => {
    if (!hasSelectedLines) return;

    const lineById = new Map(
      items
        .filter((item): item is EstimateItem => item.item_type === "line")
        .map((item) => [item.id, item])
    );
    const rows = selectedLineIdList
      .map((itemId) => lineById.get(itemId) ?? null)
      .filter((item): item is EstimateItem => item !== null)
      .map((item) => ({
        designation: item.title,
        quantity: item.quantity,
        unit: isV3Paste
          // v3 (2.8) : une ligne non chiffrée sort avec la mention de son statut, relue comme ce statut au collage.
          ? v3ClipboardUnit({ unit_code: (mergedUnitDrafts[item.id] ?? "").trim() || null, pricing_status: item.pricing_status ?? null })
          : (mergedUnitDrafts[item.id] ?? item.description ?? "").trim() || null,
        unit_price_ht:
          typeof item.unit_price_ht_cents === "number"
            ? Number((item.unit_price_ht_cents / 100).toFixed(2))
            : null,
        supply_type:
          item.supply_type_id && supplyTypeById.has(item.supply_type_id)
            ? (supplyTypeById.get(item.supply_type_id)?.name ?? null)
            : null,
        k_fo: item.k_fo,
        // v3 (2.8) : les heures par unité saisies, que le collage dans une v3 relit ; jamais les heures dérivées.
        ...(isV3Paste ? { h_mo_per_unit: item.h_mo_per_unit } : { h_mo: item.h_mo }),
        k_mo: item.k_mo,
        h_mo_majoration:
          typeof item.h_mo_majoration === "number" ? item.h_mo_majoration : null,
      }));

    const tsv = serializeSelectedRowsToTsv(rows, {
      fields: isV3Paste ? V3_CLIPBOARD_FIELD_ORDER : DEFAULT_CLIPBOARD_FIELD_ORDER,
      includeHeader: true,
    });

    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(tsv);
        return;
      } catch {
        // Fall back to the legacy copy path when async clipboard access is blocked.
      }
    }

    const textarea = document.createElement("textarea");
    textarea.value = tsv;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }, [hasSelectedLines, isV3Paste, items, mergedUnitDrafts, selectedLineIdList, supplyTypeById]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const target = event.target;
      const withinTable =
        tableCardRef.current && target instanceof Node
          ? tableCardRef.current.contains(target)
          : false;

      if (!withinTable) {
        return;
      }

      if (isReadOnly || isTextEditingTarget(target)) {
        return;
      }

      const clipboardText = event.clipboardData?.getData("text/plain") ?? "";
      if (!clipboardText.trim()) {
        return;
      }

      event.preventDefault();
      openPastePreviewFromText(clipboardText);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [isReadOnly, openPastePreviewFromText, tableCardRef]);

  return {
    isPastePreviewOpen,
    detectedClipboardFormatForDialog,
    pasteMappingEntries,
    pasteDialogRows,
    pasteErrors,
    isPastingRows,
    pasteLaborRoleField,
    handlePasteLaborRoleChange,
    openPastePreviewFromText,
    handlePasteMappingChange,
    handleTogglePasteRow,
    handleConfirmPastePreview,
    closePastePreview,
    copySelectedRowsToClipboard,
  };
}

export type UseEstimateClipboardResult = ReturnType<typeof useEstimateClipboard>;
