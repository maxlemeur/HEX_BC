import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        info: "border-info-border bg-info-subtle text-info",
        success: "border-success-border bg-success-subtle text-success",
        warning: "border-warning-border bg-warning-subtle text-warning",
        danger: "border-danger-border bg-danger-subtle text-danger",
      },
    },
    defaultVariants: { variant: "info" },
  }
)

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const

type AlertProps = React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    /** Hide the leading icon (e.g. when the content already starts with one). */
    hideIcon?: boolean
  }

/**
 * Inline message. `danger` is announced immediately (role=alert); the others politely
 * (role=status), so routine confirmations do not interrupt screen-reader users.
 */
function Alert({ className, variant = "info", hideIcon = false, role, children, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? "info"]
  return (
    <div
      data-slot="alert"
      role={role ?? (variant === "danger" ? "alert" : "status")}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {hideIcon ? null : <Icon aria-hidden="true" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="alert-title" className={cn("font-semibold", className)} {...props} />
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-foreground-secondary [&_p]:leading-relaxed", className)}
      {...props}
    />
  )
}

export { Alert, AlertDescription, AlertTitle, alertVariants }
