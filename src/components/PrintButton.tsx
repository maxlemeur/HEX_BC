"use client";

import { useEffect, useRef } from "react";

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
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="6 9 6 2 18 2 18 9" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect width="12" height="8" x="6" y="14" />
      </svg>
      Imprimer / PDF
    </button>
  );
}
