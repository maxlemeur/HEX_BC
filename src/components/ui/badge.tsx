import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/** House pills (the legacy `.status-badge` look): rounded, semibold, optional status dot. */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border font-semibold whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-muted text-foreground-secondary",
        info: "border-transparent bg-info-light text-info",
        success: "border-transparent bg-success-light text-success",
        warning: "border-transparent bg-warning-light text-warning",
        danger: "border-transparent bg-danger-light text-danger",
        brand: "border-transparent bg-primary/10 text-primary",
        accent: "border-transparent bg-brand-orange/10 text-brand-orange-dark",
        outline: "border-border bg-surface text-foreground-secondary",
        solid: "border-transparent bg-primary text-primary-foreground",
      },
      size: {
        sm: "h-5 px-2 text-micro",
        md: "h-6 px-2.5 text-xs",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "md",
    },
  }
)

const DOT_TONE: Record<NonNullable<VariantProps<typeof badgeVariants>["variant"]>, string> = {
  neutral: "bg-subtle-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  brand: "bg-primary",
  accent: "bg-brand-orange",
  outline: "bg-subtle-foreground",
  solid: "bg-primary-foreground",
}

type BadgeProps = useRender.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Leading status dot (decorative). */
    dot?: boolean
  }

function Badge({ className, variant = "neutral", size = "md", dot = false, render, children, ...props }: BadgeProps) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, size }), className),
        children: (
          <>
            {dot ? (
              <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[variant ?? "neutral"])} />
            ) : null}
            {children}
          </>
        ),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants, type BadgeProps }
