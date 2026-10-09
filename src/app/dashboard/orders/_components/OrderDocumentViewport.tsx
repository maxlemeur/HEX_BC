import { cn } from "@/lib/utils";

type OrderDocumentViewportProps = {
  /** Accessible name of the scrollable region. */
  label: string;
  children: React.ReactNode;
  className?: string;
};

/**
 * Keeps the A4 purchase order at its real width: on narrow screens it scrolls inside this
 * focusable region instead of being clipped. Print output is left untouched.
 */
export function OrderDocumentViewport({ label, children, className }: OrderDocumentViewportProps) {
  return (
    <div className={cn("print:m-0", className)}>
      <p className="no-print mb-1 text-xs text-muted-foreground md:hidden">
        Document au format A4 : faites-le défiler horizontalement pour tout voir.
      </p>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="relative overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring print:overflow-visible"
      >
        {/* Bottom padding keeps the sheet shadow from being cut by the scroll container. */}
        <div className="min-w-[210mm] pb-6 print:min-w-0 print:pb-0">{children}</div>
      </div>
    </div>
  );
}
