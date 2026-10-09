import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";

type OrderFormActionsProps = {
  cancelHref: string;
  submitLabel: string;
  submitIcon?: React.ReactNode;
  loading: boolean;
  disabled?: boolean;
  /** Submission error, shown next to the button that triggered it. */
  error?: string | null;
};

/**
 * Sticky footer of the order form: the A4 document is long, so the submit button and its
 * error stay in view while the user fills the lines.
 */
export function OrderFormActions({
  cancelHref,
  submitLabel,
  submitIcon,
  loading,
  disabled = false,
  error,
}: OrderFormActionsProps) {
  return (
    <div className="no-print sticky bottom-0 z-10 -mx-3 mt-2 flex flex-col gap-3 border-t border-border bg-surface/95 px-3 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-lg sm:border sm:px-4 sm:shadow-card">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <div className="flex items-center justify-end gap-2">
        <Link href={cancelHref} className={buttonVariants({ variant: "outline", size: "lg", className: "hidden sm:inline-flex" })}>
          Annuler
        </Link>
        <Button
          type="submit"
          variant="accent"
          size="lg"
          loading={loading}
          disabled={disabled}
          leftIcon={submitIcon}
          className="w-full sm:w-auto"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
