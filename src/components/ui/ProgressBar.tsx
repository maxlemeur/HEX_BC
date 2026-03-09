type ProgressBarProps = {
  value: number;
  color?: "brand" | "success" | "warning" | "danger";
  size?: "sm" | "md";
  showLabel?: boolean;
};

const COLOR_MAP: Record<NonNullable<ProgressBarProps["color"]>, string> = {
  brand: "bg-brand-blue",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

const SIZE_MAP: Record<NonNullable<ProgressBarProps["size"]>, string> = {
  sm: "h-1.5",
  md: "h-2.5",
};

export function ProgressBar({
  value,
  color = "brand",
  size = "md",
  showLabel,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 overflow-hidden rounded-full bg-slate-100 ${SIZE_MAP[size]}`}>
        <div
          className={`rounded-full transition-all duration-500 ease-out ${SIZE_MAP[size]} ${COLOR_MAP[color]}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs tabular-nums text-slate-500">{clamped}%</span>
      )}
    </div>
  );
}
