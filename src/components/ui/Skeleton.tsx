import { cn } from "@/lib/utils";

type SkeletonVariant = "text" | "circle" | "rect" | "card";

export type SkeletonProps = {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
  count?: number;
  rounded?: boolean;
};

const VARIANT_DEFAULTS: Record<SkeletonVariant, string> = {
  text: "h-4 w-full rounded",
  circle: "h-10 w-10 rounded-full",
  rect: "h-20 w-full rounded-lg",
  card: "h-36 w-full rounded-2xl",
};

function SkeletonBlock({
  variant = "text",
  width,
  height,
  className,
  rounded,
}: Omit<SkeletonProps, "count">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "bg-slate-200/50 animate-shimmer",
        VARIANT_DEFAULTS[variant],
        rounded && "rounded-full",
        className
      )}
      style={{
        ...(width != null
          ? { width: typeof width === "number" ? `${width}px` : width }
          : {}),
        ...(height != null
          ? { height: typeof height === "number" ? `${height}px` : height }
          : {}),
      }}
    />
  );
}

export function Skeleton({
  count = 1,
  ...props
}: Readonly<SkeletonProps>) {
  if (count <= 1) {
    return <SkeletonBlock {...props} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonBlock key={i} {...props} />
      ))}
    </div>
  );
}
