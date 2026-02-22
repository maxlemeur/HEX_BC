import { cn } from "@/lib/utils";

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "error";
type BadgeSize = "sm" | "md";

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  neutral: "bg-[var(--slate-100)] text-[var(--slate-600)]",
  info: "bg-[var(--info-light)] text-[var(--info)]",
  success: "bg-[var(--success-light)] text-[var(--success)]",
  warning: "bg-[var(--warning-light)] text-[var(--warning)]",
  error: "bg-[var(--error-light)] text-[var(--danger)]",
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
