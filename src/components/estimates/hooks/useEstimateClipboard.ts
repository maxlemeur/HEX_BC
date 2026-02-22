"use client";

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

import {
  CLIPBOARD_TARGET_FIELDS,
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
  type ClipboardTargetField,
  type ClipboardTsvMatrix,
} from "@/lib/estimates/clipboard";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];

type PastePreviewDialogRow = {
  id: string;
  rowNumber: number;
  include: boolean;
  values: Record<string, string | number | boolean | null>;
  invalidReasons: string[];
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
  onPasteRows: (input: {
    anchorRowId: string | null;
    rows: ClipboardPreviewValues[];
  }) => Promise<void>;
};

const CLIPBOARD_TARGET_FIELD_LABELS: Record<ClipboardTargetField, string> = {
  designation: "Designation",
  quantity: "Quantite",
  unit: "Unite",
  unit_price_ht: "Prix unitaire HT",
  supply_type: "Type FO",
  k_fo: "K FO",
  h_mo: "h MO",
  k_mo: "K MO",
  h_mo_majoration: "Majoration MO",
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

  const clipboardTargetOptions = useMemo(() => {
    return CLIPBOARD_TARGET_FIELDS.map((field) => ({
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
        pasteIncludedByLineNumber[row.lineNumber] ?? row.status === "valid";

      return {
        id: rowId,
        rowNumber: row.lineNumber,
        include,
        values: row.rawValues,
        invalidReasons: row.reasons,
      };
    });
  }, [pasteIncludedByLineNumber, pastePreviewRows]);

  const detectedClipboardFormatForDialog = useMemo<"bdc" | "optima" | "generic">(() => {
    if (detectedClipboardFormat === "bdc_v1_1") return "bdc";
    if (detectedClipboardFormat === "optima") return "optima";
    return "generic";
  }, [detectedClipboardFormat]);

  const openPastePreviewFromText = useCallback((rawText: string) => {
    const matrix = parseTsvMatrix(rawText);
    const errors: string[] = [];

    if (matrix.headers.length === 0 || matrix.rows.length === 0) {
      errors.push("Aucune ligne exploitable detectee dans le presse-papier.");
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
    setPasteIncludedByLineNumber(() => {
      const initial: Record<number, boolean> = {};
      preview.rows.forEach((row) => {
        initial[row.lineNumber] = row.status === "valid";
      });
      return initial;
    });
    setIsPastePreviewOpen(true);
  }, [insertionAnchorItemIdRef]);

  const handlePasteMappingChange = useCallback(
    (sourceColumn: string, targetField: string | null) => {
      if (!pasteMatrix) return;

      setPasteMapping((previous) => {
        const next: ClipboardColumnMapping = { ...previous };
        if (!targetField) {
          delete next[sourceColumn];
        } else if (CLIPBOARD_TARGET_FIELDS.includes(targetField as ClipboardTargetField)) {
          next[sourceColumn] = targetField as ClipboardTargetField;
        }

        const preview = buildClipboardPreviewRows(pasteMatrix, next);
        setPastePreviewRows(preview.rows);
        setPasteIncludedByLineNumber((previousInclude) => {
          const merged: Record<number, boolean> = {};
          preview.rows.forEach((row) => {
            const existing = previousInclude[row.lineNumber];
            merged[row.lineNumber] =
              existing !== undefined ? existing : row.status === "valid";
          });
          return merged;
        });
        return next;
      });
    },
    [pasteMatrix]
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
  }, []);

  const handleConfirmPastePreview = useCallback(async () => {
    if (isReadOnly || isPastingRows) return;

    const selectedRows = pastePreviewRows.filter((row) => {
      const include = pasteIncludedByLineNumber[row.lineNumber] ?? row.status === "valid";
      return include && row.status === "valid" && Boolean(row.values.designation);
    });

    if (selectedRows.length === 0) {
      setPasteErrors(["Aucune ligne valide selectionnee pour insertion."]);
      return;
    }

    setIsPastingRows(true);
    setPasteErrors([]);

    try {
      await onPasteRows({
        anchorRowId: pasteAnchorRowId,
        rows: selectedRows.map((row) => row.values),
      });
      closePastePreview();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Impossible d'inserer les lignes collees.";
      setPasteErrors([message]);
    } finally {
      setIsPastingRows(false);
    }
  }, [
    closePastePreview,
    isPastingRows,
    isReadOnly,
    onPasteRows,
    pasteAnchorRowId,
    pasteIncludedByLineNumber,
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
        unit: (mergedUnitDrafts[item.id] ?? item.description ?? "").trim() || null,
        unit_price_ht:
          typeof item.unit_price_ht_cents === "number"
            ? Number((item.unit_price_ht_cents / 100).toFixed(2))
            : null,
        supply_type:
          item.supply_type_id && supplyTypeById.has(item.supply_type_id)
            ? (supplyTypeById.get(item.supply_type_id)?.name ?? null)
            : null,
        k_fo: item.k_fo,
        h_mo: item.h_mo,
        k_mo: item.k_mo,
        h_mo_majoration:
          typeof item.h_mo_majoration === "number" ? item.h_mo_majoration : null,
      }));

    const tsv = serializeSelectedRowsToTsv(rows, {
      fields: DEFAULT_CLIPBOARD_FIELD_ORDER,
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
  }, [hasSelectedLines, items, mergedUnitDrafts, selectedLineIdList, supplyTypeById]);

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
    openPastePreviewFromText,
    handlePasteMappingChange,
    handleTogglePasteRow,
    handleConfirmPastePreview,
    closePastePreview,
    copySelectedRowsToClipboard,
  };
}

export type UseEstimateClipboardResult = ReturnType<typeof useEstimateClipboard>;
