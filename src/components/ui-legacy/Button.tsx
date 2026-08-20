import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success" | "accent";
type ButtonSize = "xs" | "sm" | "md" | "lg" | "xl";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-[var(--shadow-primary-glow)] hover:brightness-[1.04] hover:shadow-[0_8px_22px_-6px_rgb(30_58_95_/_0.45)]",
  secondary:
    "border border-primary/20 bg-transparent text-primary hover:bg-primary/5 hover:text-primary",
  ghost:
    "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  danger: "bg-error-light text-red-700 hover:bg-red-100",
  success: "bg-success-light text-emerald-700 hover:bg-emerald-100",
  accent:
    "bg-brand-orange text-white shadow-[0_4px_14px_-2px_rgb(232_115_47_/_0.4)] hover:brightness-[1.04] hover:shadow-[0_8px_22px_-6px_rgb(232_115_47_/_0.45)]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: "h-7 min-w-8 rounded-button-sm px-2 text-xs font-medium",
  sm: "h-8 min-w-8 rounded-button-sm px-3 text-sm font-medium",
  md: "h-9 min-w-16 rounded-button px-4 text-base font-medium",
  lg: "h-11 min-w-16 rounded-button px-5 text-base font-semibold",
  xl: "h-12 min-w-16 rounded-button-lg px-6 text-md font-semibold",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  leftIcon,
  rightIcon,
  disabled,
  children,
  ref,
  ...props
}: Readonly<ButtonProps>) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      className={cn(
        "relative inline-flex items-center justify-center whitespace-nowrap transition duration-150",
        "font-body active:not(:disabled):scale-[0.97]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-40",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      aria-busy={loading}
      disabled={isDisabled}
      {...props}
    >
      <span className={cn("inline-flex items-center gap-1.5", loading && "opacity-0")}>
        {leftIcon ?? null}
        <span>{children}</span>
        {rightIcon ?? null}
      </span>

      {loading ? (
        <span
          aria-hidden="true"
          className="absolute inset-0 m-auto size-4 animate-spin rounded-full border-2 border-current/30 border-t-current"
        />
      ) : null}
    </button>
  );
}
