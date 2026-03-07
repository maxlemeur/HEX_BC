import { cn } from "@/lib/utils";

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "error";
type BadgeSize = "sm" | "md";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-info-light text-blue-800",
  success: "bg-success-light text-emerald-800",
  warning: "bg-warning-light text-amber-900",
  error: "bg-error-light text-red-800",
};

const BADGE_SIZES: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  size?: BadgeSize;
  withDot?: boolean;
};

export function Badge({
  variant = "neutral",
  size = "md",
  withDot,
  className,
  children,
  ...props
}: Readonly<BadgeProps>) {
  return (
    <span
      data-variant={variant}
      data-size={size}
      className={cn(
        "ui-badge font-body inline-flex items-center gap-1.5 rounded-full font-medium tracking-[0.02em] transition-colors duration-200",
        BADGE_VARIANTS[variant],
        BADGE_SIZES[size],
        className
      )}
      {...props}
    >
      {withDot ? (
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}
