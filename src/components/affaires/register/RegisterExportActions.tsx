"use client";

import { useState } from "react";
import { Download, Ellipsis } from "lucide-react";

import { fetchAffaireRegisterReviewExportAction } from "@/app/dashboard/affaires/_actions/register";
import { useToast } from "@/components/feedback/toast-provider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

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
          title: "Export prêt",
          description:
            "Le CSV et la note de revue interne ont été téléchargés.",
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
    <DropdownMenu>
      <DropdownMenuTrigger
        className="register-icon-button"
        aria-label={isExporting ? "Export de la revue en cours" : "Actions du registre"}
        disabled={isExporting}
      >
        <Ellipsis size={20} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 bg-surface text-foreground">
        <DropdownMenuItem onClick={handleExport} disabled={isExporting} className="min-h-11 px-3">
          <Download size={16} aria-hidden="true" />
          Exporter la revue
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
