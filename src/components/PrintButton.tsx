"use client";

import { useEffect, useRef } from "react";
import { PrinterIcon } from "lucide-react";

type PrintButtonProps = {
  autoPrint?: boolean;
};

export function PrintButton({ autoPrint = false }: PrintButtonProps) {
  const didAutoPrint = useRef(false);

  useEffect(() => {
    if (!autoPrint || didAutoPrint.current) {
      return;
    }

    didAutoPrint.current = true;

    const triggerPrint = async () => {
      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // Best-effort wait; printing can proceed without font readiness.
        }
      }

      requestAnimationFrame(() => {
        window.print();
      });
    };

    void triggerPrint();
  }, [autoPrint]);

  return (
    <button
      className="btn btn-primary btn-lg"
      onClick={() => window.print()}
      type="button"
    >
      <PrinterIcon aria-hidden="true" size={18} />
      Imprimer / PDF
    </button>
  );
}
