"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { PrinterIcon } from "lucide-react";

import { EstimatePdfLayoutModal } from "@/components/estimates/EstimatePdfLayoutModal";
import { Button } from "@/components/ui/button";
import {
  writeEstimatePdfLayoutSearchParams,
  type EstimatePdfLayoutOptions,
} from "@/lib/estimates/pdf-layout";

type EstimatePrintLayoutButtonProps = {
  versionId: string;
  initialLayout: EstimatePdfLayoutOptions;
  autoPrint?: boolean;
};

export function EstimatePrintLayoutButton({
  versionId,
  initialLayout,
  autoPrint = false,
}: Readonly<EstimatePrintLayoutButtonProps>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const didAutoPrint = useRef(false);

  useEffect(() => {
    if (!autoPrint || didAutoPrint.current) return;
    didAutoPrint.current = true;

    const triggerPrint = async () => {
      const cleanedParams = new URLSearchParams(window.location.search);
      cleanedParams.delete("auto_print");
      const cleanedQuery = cleanedParams.toString();
      window.history.replaceState(
        window.history.state,
        "",
        cleanedQuery ? `${pathname}?${cleanedQuery}` : pathname
      );

      if (document.fonts?.ready) {
        try {
          await document.fonts.ready;
        } catch {
          // Printing remains available when font readiness cannot be observed.
        }
      }
      window.requestAnimationFrame(() => window.print());
    };

    void triggerPrint();
  }, [autoPrint, pathname]);

  const handleConfirm = (layout: EstimatePdfLayoutOptions) => {
    const params = writeEstimatePdfLayoutSearchParams(
      layout,
      new URLSearchParams(searchParams.toString())
    );
    params.set("auto_print", "1");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <>
      <Button
        variant="primary"
        size="lg"
        className="w-full sm:w-auto"
        type="button"
        onClick={() => setOpen(true)}
        leftIcon={<PrinterIcon aria-hidden="true" />}
      >
        Mise en page / imprimer
      </Button>
      <EstimatePdfLayoutModal
        open={open}
        onOpenChange={setOpen}
        versionId={versionId}
        requiresDraftLock={false}
        initialLayout={initialLayout}
        confirmLabel="Appliquer et imprimer"
        onConfirm={handleConfirm}
      />
    </>
  );
}
