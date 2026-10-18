"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, DownloadIcon, FileSpreadsheetIcon, FileTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ExportDropdownProps = {
  onExportExcel: () => void;
  onExportCSV: () => void;
  disabled?: boolean;
  /** Ferme une seule entrée ; le menu reste ouvrable tant qu'une entrée est disponible. */
  excelDisabled?: boolean;
  csvDisabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
};

const itemClass =
  "flex w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm font-medium text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function ExportDropdown({
  onExportExcel,
  onExportCSV,
  disabled = false,
  excelDisabled = false,
  csvDisabled = false,
  loading = false,
  loadingLabel = "Export en cours…",
}: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleExcelClick = useCallback(() => {
    setIsOpen(false);
    onExportExcel();
  }, [onExportExcel]);

  const handleCSVClick = useCallback(() => {
    setIsOpen(false);
    onExportCSV();
  }, [onExportCSV]);

  return (
    <div ref={containerRef} className="relative">
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        size="md"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || loading || (excelDisabled && csvDisabled)}
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
        leftIcon={<DownloadIcon aria-hidden="true" />}
        rightIcon={
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("size-3.5 transition-transform motion-reduce:transition-none", isOpen && "rotate-180")}
          />
        }
      >
        {loading ? loadingLabel : "Exporter"}
      </Button>

      {isOpen && (
        <div
          id={panelId}
          className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-dropdown"
        >
          <button
            type="button"
            className={itemClass}
            onClick={handleExcelClick}
            disabled={loading || excelDisabled}
          >
            <FileSpreadsheetIcon aria-hidden="true" />
            Excel (.xlsx)
          </button>
          <button
            type="button"
            className={itemClass}
            onClick={handleCSVClick}
            disabled={loading || csvDisabled}
          >
            <FileTextIcon aria-hidden="true" />
            Fichier CSV (.csv)
          </button>
        </div>
      )}
    </div>
  );
}
