import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * House buttons on Base UI. Sizes map the legacy classes: `.btn-sm` → md (36px),
 * `.btn` → lg (density input height, 40px), `.btn-lg` → xl. `secondary` is the navy
 * outline of the legacy React Button; `outline` is the neutral `.btn-secondary`.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control border border-transparent font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-primary-glow hover:bg-brand-blue-light",
        secondary: "border-primary/25 bg-transparent text-primary hover:bg-primary/5",
        outline:
          "border-border bg-surface text-foreground-secondary hover:border-border-strong hover:bg-surface-subtle hover:text-foreground aria-expanded:bg-surface-subtle",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        danger:
          "border-danger-border bg-surface text-danger hover:border-danger hover:bg-danger-subtle",
        "danger-solid": "bg-danger text-danger-foreground hover:bg-danger/90",
        success: "bg-success-subtle text-success hover:bg-success-light",
        accent:
          "bg-brand-orange text-white shadow-[0_4px_14px_-2px_rgb(180_83_9/0.35)] hover:bg-brand-orange-dark",
        link: "h-auto! border-0 px-0! text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-3 text-sm [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-9 px-3.5 text-sm",
        lg: "h-(--density-input-h) px-5 text-base",
        xl: "h-12 px-6 text-md",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-8",
        icon: "size-9",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Keeps the width, shows a spinner and blocks repeated clicks. */
    loading?: boolean
    leftIcon?: React.ReactNode
    rightIcon?: React.ReactNode
  }

function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  leftIcon,
  rightIcon,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="animate-spin motion-reduce:animate-none" />
        </span>
      ) : null}
      <span className={cn("contents", loading && "invisible")}>
        {leftIcon}
        {children}
        {rightIcon}
      </span>
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants, type ButtonProps }
