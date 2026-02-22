import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:brightness-110",
  secondary:
    "border border-[var(--border)] bg-white text-[var(--slate-700)] hover:bg-[var(--slate-50)]",
  ghost: "bg-transparent text-[var(--slate-600)] hover:bg-[var(--slate-100)] hover:text-[var(--slate-900)]",
  danger: "border border-danger/30 bg-white text-danger hover:bg-[var(--error-light)]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-9 rounded-[10px] px-3 text-xs",
  md: "h-11 rounded-[12px] px-5 text-sm",
  lg: "h-[52px] rounded-[14px] px-7 text-sm",
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
        "inline-flex items-center justify-center gap-2 font-semibold transition duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-60",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      aria-busy={loading}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-current/30 border-t-current"
        />
      ) : (
        leftIcon ?? null
      )}
      <span>{children}</span>
      {!loading ? rightIcon ?? null : null}
    </button>
  );
}
