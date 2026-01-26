"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ExportDropdownProps = {
  onExportExcel: () => void;
  onExportCSV: () => void;
  disabled?: boolean;
};

export function ExportDropdown({
  onExportExcel,
  onExportCSV,
  disabled = false,
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
        disabled={disabled}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Exporter
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-[var(--slate-200)] bg-white p-2 shadow-lg z-50">
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[var(--slate-700)] hover:bg-[var(--slate-50)] transition-colors"
            onClick={handleExcelClick}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" fill="#10b981" />
              <path
                d="M8 8l3 4-3 4M13 8l3 4-3 4"
                stroke="white"
                strokeWidth="2"
              />
            </svg>
            Excel (.xlsx)
          </button>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-[var(--slate-700)] hover:bg-[var(--slate-50)] transition-colors"
            onClick={handleCSVClick}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" fill="#64748b" />
              <path d="M7 8h10M7 12h10M7 16h6" stroke="white" strokeWidth="2" />
            </svg>
            Fichier CSV (.csv)
          </button>
        </div>
      )}
    </div>
  );
}
