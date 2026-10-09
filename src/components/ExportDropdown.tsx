"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDownIcon, DownloadIcon, SquareChevronRightIcon, SquareMenuIcon } from "lucide-react";

type ExportDropdownProps = {
  onExportExcel: () => void;
  onExportCSV: () => void;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
};

export function ExportDropdown({
  onExportExcel,
  onExportCSV,
  disabled = false,
  loading = false,
  loadingLabel = "Export en cours...",
}: ExportDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || loading}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <DownloadIcon aria-hidden="true" size={16} />
        {loading ? loadingLabel : "Exporter"}
        <ChevronDownIcon aria-hidden="true" className={`transition-transform ${isOpen ? "rotate-180" : ""}`} size={14} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-border bg-surface p-2 shadow-lg z-50">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground-secondary hover:bg-surface-subtle transition-colors"
            onClick={handleExcelClick}
            disabled={loading}
          >
            <SquareChevronRightIcon aria-hidden="true" size={18} />
            Excel (.xlsx)
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground-secondary hover:bg-surface-subtle transition-colors"
            onClick={handleCSVClick}
            disabled={loading}
          >
            <SquareMenuIcon aria-hidden="true" size={18} />
            Fichier CSV (.csv)
          </button>
        </div>
      )}
    </div>
  );
}
