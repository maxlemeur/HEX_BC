"use client";

import { useEffect, useRef } from "react";
import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

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
    <Button
      variant="primary"
      size="lg"
      onClick={() => window.print()}
      type="button"
      leftIcon={<PrinterIcon aria-hidden="true" />}
    >
      Imprimer / PDF
    </Button>
  );
}
