"use client";

import { useCallback, useState } from "react";
import { ChevronDownIcon, DownloadIcon, FileSpreadsheetIcon, FileTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  const triggerDisabled = disabled || loading || (excelDisabled && csvDisabled);

  const handleExcelClick = useCallback(() => {
    setIsOpen(false);
    onExportExcel();
  }, [onExportExcel]);

  const handleCSVClick = useCallback(() => {
    setIsOpen(false);
    onExportCSV();
  }, [onExportCSV]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={triggerDisabled}
            leftIcon={<DownloadIcon aria-hidden="true" />}
            rightIcon={
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform motion-reduce:transition-none",
                  isOpen && "rotate-180"
                )}
              />
            }
          />
        }
      >
        {loading ? loadingLabel : "Exporter"}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-52 gap-0 p-1">
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
      </PopoverContent>
    </Popover>
  );
}
