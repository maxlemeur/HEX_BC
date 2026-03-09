import { useId } from "react";

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showArea?: boolean;
};

export function Sparkline({
  data,
  width = 100,
  height = 32,
  color = "var(--brand-blue)",
  showArea = true,
}: SparklineProps) {
  const id = useId();

  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  const polylinePoints = points.join(" ");
  const gradientId = `sparkline-grad-${id}`;

  const areaPoints = `0,${height} ${polylinePoints} ${width},${height}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
    >
      {showArea && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={areaPoints} fill={`url(#${gradientId})`} />
        </>
      )}
      <polyline
        points={polylinePoints}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
