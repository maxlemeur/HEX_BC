"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";

import type {
  ApprovedPdfTable,
  ImportFileOptions,
  TabularPdfReviewPayload,
} from "@/hooks/useImportFlow";
import {
  getFileExtension,
  IMPORT_WIZARD_VALID_EXTENSIONS,
  scanFileHeaders,
} from "@/components/imports/importWizardFileScan";

export type FileStage =
  | "idle"
  | "validating"
  | "scanning"
  | "reviewing_pdf"
  | "pdf_review"
  | "invalid"
  | "ready"
  | "header_needed";

type UseImportWizardFileStageInput = {
  fileInputRef: RefObject<HTMLInputElement | null>;
  importFile: (
    file: File,
    options?: ImportFileOptions
  ) => Promise<boolean>;
  importReviewedPdfFile: (input: {
    file: File;
    pdfReview: TabularPdfReviewPayload;
    approvedTables: ApprovedPdfTable[];
  }) => Promise<boolean>;
  isSubmitting: boolean;
  reviewTabularPdfFile: (file: File) => Promise<TabularPdfReviewPayload>;
};

type UseImportWizardFileStageResult = {
  approvedPdfTables: ApprovedPdfTable[];
  clearSelectedFile: () => void;
  detectedHeaderRow: number | null;
  detectedHeaders: string[];
  fileStage: FileStage;
  formatError: string | null;
  handleDragLeave: () => void;
  handleDragOver: (event: React.DragEvent) => void;
  handleDrop: (event: React.DragEvent) => void;
  handleFileSelection: (file: File | null) => void;
  handleFormSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleHeaderRowInputChange: (value: string) => void;
  handlePdfReviewSubmit: () => Promise<void>;
  handleTogglePdfTable: (table: ApprovedPdfTable) => void;
  headerRowError: string | null;
  headerRowInput: string;
  isDragOver: boolean;
  pdfReview: TabularPdfReviewPayload | null;
  pdfReviewError: string | null;
  selectedFile: File | null;
};

export function useImportWizardFileStage({
  fileInputRef,
  importFile,
  importReviewedPdfFile,
  isSubmitting,
  reviewTabularPdfFile,
}: UseImportWizardFileStageInput): UseImportWizardFileStageResult {
  const [approvedPdfTables, setApprovedPdfTables] = useState<ApprovedPdfTable[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [detectedHeaderRow, setDetectedHeaderRow] = useState<number | null>(null);
  const [fileStage, setFileStage] = useState<FileStage>("idle");
  const [formatError, setFormatError] = useState<string | null>(null);
  const [headerRowError, setHeaderRowError] = useState<string | null>(null);
  const [headerRowInput, setHeaderRowInput] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const [pdfReview, setPdfReview] = useState<TabularPdfReviewPayload | null>(null);
  const [pdfReviewError, setPdfReviewError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const scanAbortRef = useRef(0);

  const resetFileSelectionState = useCallback(() => {
    setSelectedFile(null);
    setFileStage("idle");
    setDetectedHeaders([]);
    setDetectedHeaderRow(null);
    setFormatError(null);
    setHeaderRowError(null);
    setHeaderRowInput("");
    setIsDragOver(false);
    setPdfReviewError(null);
    setPdfReview(null);
    setApprovedPdfTables([]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [fileInputRef]);

  useEffect(() => {
    if (!selectedFile) {
      scanAbortRef.current += 1;
      return;
    }

    const scanId = ++scanAbortRef.current;

    const run = async () => {
      setFileStage("validating");
      setFormatError(null);
      setHeaderRowError(null);
      setDetectedHeaders([]);
      setDetectedHeaderRow(null);
      setPdfReviewError(null);
      setPdfReview(null);
      setApprovedPdfTables([]);
      setHeaderRowInput("");

      const ext = getFileExtension(selectedFile.name);
      if (!ext || !IMPORT_WIZARD_VALID_EXTENSIONS.has(ext)) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        if (scanAbortRef.current !== scanId) return;

        setFileStage("invalid");
        setFormatError(
          `Le format .${ext ?? "inconnu"} n'est pas supporté. Utilisez un fichier CSV, XLSX, XLS ou PDF.`
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
      if (scanAbortRef.current !== scanId) return;

      if (ext === "pdf") {
        setFileStage("reviewing_pdf");

        try {
          const review = await reviewTabularPdfFile(selectedFile);
          if (scanAbortRef.current !== scanId) return;

          setPdfReview(review);
          setApprovedPdfTables(review.review.suggested_approved_tables);
          setFileStage("pdf_review");
        } catch (error) {
          if (scanAbortRef.current !== scanId) return;

          setFileStage("invalid");
          setPdfReviewError(
            error instanceof Error
              ? error.message
              : "Analyse du PDF tabulaire impossible."
          );
        }
        return;
      }

      setFileStage("scanning");

      try {
        const result = await scanFileHeaders(selectedFile, ext);
        if (scanAbortRef.current !== scanId) return;

        if (result.headers.length >= 2) {
          setDetectedHeaders(result.headers);
          setDetectedHeaderRow(result.headerRow);
          setFileStage("ready");
        } else {
          setDetectedHeaders([]);
          setDetectedHeaderRow(null);
          setFileStage("header_needed");
        }
      } catch {
        if (scanAbortRef.current !== scanId) return;

        setDetectedHeaders([]);
        setDetectedHeaderRow(null);
        setFileStage("ready");
      }
    };

    void run();
  }, [reviewTabularPdfFile, selectedFile]);

  const handleFileSelection = useCallback(
    (file: File | null) => {
      if (!file) {
        resetFileSelectionState();
        return;
      }

      setSelectedFile(file);
      setIsDragOver(false);
    },
    [resetFileSelectionState]
  );

  const handleFormSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!selectedFile || isSubmitting) return;

      const trimmedHeaderRow = headerRowInput.trim();
      let headerRowNumber: number | null = null;

      if (trimmedHeaderRow.length > 0) {
        const parsed = Number(trimmedHeaderRow);
        if (!Number.isInteger(parsed) || parsed < 1) {
          setHeaderRowError("La ligne d'en-tête doit être un entier >= 1.");
          return;
        }
        headerRowNumber = parsed;
      }

      setHeaderRowError(null);
      const success = await importFile(selectedFile, { headerRowNumber });
      if (!success) return;

      resetFileSelectionState();
    },
    [headerRowInput, importFile, isSubmitting, resetFileSelectionState, selectedFile]
  );

  const handlePdfReviewSubmit = useCallback(async () => {
    if (!selectedFile || isSubmitting) return;

    if (!pdfReview) {
      setPdfReviewError("Analyse PDF indisponible. Recommencez avec un autre fichier.");
      return;
    }

    if (approvedPdfTables.length === 0) {
      setPdfReviewError("Retenez au moins un tableau avant de rejoindre le mapping standard.");
      return;
    }

    const success = await importReviewedPdfFile({
      file: selectedFile,
      pdfReview,
      approvedTables: approvedPdfTables,
    });
    if (!success) return;

    resetFileSelectionState();
  }, [
    approvedPdfTables,
    importReviewedPdfFile,
    isSubmitting,
    pdfReview,
    resetFileSelectionState,
    selectedFile,
  ]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragOver(false);

      const file = event.dataTransfer.files?.[0];
      if (file) {
        setSelectedFile(file);
      }
    },
    []
  );

  const handleHeaderRowInputChange = useCallback(
    (value: string) => {
      setHeaderRowInput(value);
      if (headerRowError) {
        setHeaderRowError(null);
      }
    },
    [headerRowError]
  );

  const handleTogglePdfTable = useCallback((table: ApprovedPdfTable) => {
    setPdfReviewError(null);
    setApprovedPdfTables((current) => {
      const alreadySelected = current.some(
        (entry) =>
          entry.sourcePage === table.sourcePage &&
          entry.tableIndex === table.tableIndex
      );

      if (alreadySelected) {
        return current.filter(
          (entry) =>
            !(
              entry.sourcePage === table.sourcePage &&
              entry.tableIndex === table.tableIndex
            )
        );
      }

      return [...current, table];
    });
  }, []);

  return {
    approvedPdfTables,
    clearSelectedFile: resetFileSelectionState,
    detectedHeaderRow,
    detectedHeaders,
    fileStage,
    formatError,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileSelection,
    handleFormSubmit,
    handleHeaderRowInputChange,
    handlePdfReviewSubmit,
    handleTogglePdfTable,
    headerRowError,
    headerRowInput,
    isDragOver,
    pdfReview,
    pdfReviewError,
    selectedFile,
  };
}
