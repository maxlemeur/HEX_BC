import { cn } from "@/lib/utils";

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "error";
type BadgeSize = "sm" | "md";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-slate-100 text-slate-600",
  info: "bg-info-light text-info",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-warning",
  error: "bg-error-light text-danger",
};

const BADGE_SIZES: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
  size?: BadgeSize;
};

export function Badge({
  variant = "neutral",
  size = "md",
  className,
  children,
  ...props
}: Readonly<BadgeProps>) {
  return (
    <span
      data-variant={variant}
      data-size={size}
      className={cn(
        "ui-badge inline-flex items-center rounded-full font-medium",
        BADGE_VARIANTS[variant],
        BADGE_SIZES[size],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
