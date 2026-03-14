"use client";

import { useState } from "react";

import { fetchAffaireRegisterReviewExportAction } from "@/app/dashboard/affaires/_actions/register";
import { useToast } from "@/components/ui/Toast";

function downloadBlob(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildReviewNoteFilename(csvFilename: string) {
  return csvFilename.endsWith(".csv")
    ? `${csvFilename.slice(0, -4)}.txt`
    : `${csvFilename}.txt`;
}

type RegisterExportActionsProps = {
  projectId: string;
  versionId: string | null;
};

export function RegisterExportActions({
  projectId,
  versionId,
}: Readonly<RegisterExportActionsProps>) {
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);

  function handleExport() {
    setIsExporting(true);

    void (async () => {
      try {
        const result = await fetchAffaireRegisterReviewExportAction({
          projectId,
          versionId,
        });

        downloadBlob(
          result.csvContent,
          result.csvFilename,
          "text/csv;charset=utf-8"
        );
        downloadBlob(
          result.reviewNote,
          buildReviewNoteFilename(result.csvFilename),
          "text/plain;charset=utf-8"
        );

        toast.success({
          title: "Export pret",
          description:
            "Le CSV et la note de revue interne ont ete telecharges.",
        });
      } catch (error) {
        toast.error({
          title: "Export impossible",
          description:
            error instanceof Error
              ? error.message
              : "Impossible d'exporter la revue du registre.",
        });
      } finally {
        setIsExporting(false);
      }
    })();
  }

  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={isExporting}
      onClick={handleExport}
    >
      {isExporting ? "Export..." : "Exporter revue"}
    </button>
  );
}
