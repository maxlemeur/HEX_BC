"use client";

import { useCallback, useRef } from "react";
import { useReducedMotion } from "motion/react";

/* ─── Pipe network layout (800×600 viewBox) ─── */

const PIPES = [
  // Top-left horizontal → elbow down
  "M -20 100 H 280 Q 310 100 310 130 V 230",
  // Continues right from that elbow
  "M 310 230 Q 310 260 340 260 H 820",
  // Left vertical feeder
  "M 150 -20 V 100",
  // Center vertical → elbow right → elbow down
  "M 500 -20 V 180 Q 500 210 530 210 H 700 Q 730 210 730 240 V 350",
  // Bottom-left horizontal → elbow up → goes right
  "M -20 400 H 200 Q 230 400 230 370 V 300 Q 230 270 260 270 H 490",
  // Center cross → elbow down-right
  "M 490 270 Q 520 270 520 300 V 430 Q 520 460 550 460 H 820",
  // Bottom path → curves up
  "M -20 530 H 350 Q 380 530 380 500 V 460",
  // Right branch from pipe 4
  "M 730 350 Q 730 380 760 380 H 820",
  // Small connector between pipes 7 and 6
  "M 380 460 Q 380 430 410 430 H 520",
  // Top-right descender
  "M 650 -20 V 130 Q 650 160 680 160 H 820",
];

/** Junction points where pipes bend or connect — rendered brighter */
const JOINTS: [number, number][] = [
  [310, 100],
  [310, 260],
  [150, 100],
  [500, 210],
  [730, 210],
  [730, 350],
  [230, 400],
  [230, 270],
  [490, 270],
  [520, 270],
  [520, 460],
  [380, 530],
  [380, 460],
  [730, 380],
  [650, 160],
];

/** Fluid packets flowing through the pipes */
const PACKETS: {
  pipe: number;
  duration: number;
  delay: number;
  color: "orange" | "blue";
  mobileHidden?: boolean;
}[] = [
  { pipe: 0, duration: 5, delay: 0, color: "orange" },
  { pipe: 1, duration: 6, delay: 1.5, color: "orange" },
  { pipe: 3, duration: 7, delay: 0.5, color: "blue" },
  { pipe: 4, duration: 5.5, delay: 2, color: "orange" },
  { pipe: 5, duration: 6.5, delay: 0, color: "orange", mobileHidden: true },
  { pipe: 6, duration: 4.5, delay: 1, color: "blue", mobileHidden: true },
  { pipe: 9, duration: 5, delay: 3, color: "orange", mobileHidden: true },
];

/* ─── Component ─── */

export default function LoginPipeNetwork() {
  const svgRef = useRef<SVGSVGElement>(null);
  const prefersReduced = !!useReducedMotion();

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (prefersReduced || !svgRef.current) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width - 0.5) * 15;
      const y = ((e.clientY - rect.top) / rect.height - 0.5) * 15;
      svgRef.current.style.transform = `translate(${x}px, ${y}px)`;
    },
    [prefersReduced],
  );

  const handleMouseLeave = useCallback(() => {
    if (prefersReduced || !svgRef.current) return;
    svgRef.current.style.transform = "translate(0px, 0px)";
  }, [prefersReduced]);

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="absolute inset-0 overflow-hidden"
    >
      <svg
        ref={svgRef}
        viewBox="0 0 800 600"
        preserveAspectRatio="xMidYMid slice"
        className="h-full w-full transition-transform duration-300 ease-out"
        aria-hidden="true"
      >
        <defs>
          {/* Glow filter for fluid packets */}
          <filter id="pipeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur
              in="SourceGraphic"
              stdDeviation="3.5"
              result="blur"
            />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Orange gradient (brand) */}
          <linearGradient id="orangePacket" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style={{ stopColor: "var(--brand-orange-light)" }} />
            <stop offset="100%" style={{ stopColor: "var(--warning-border)" }} />
          </linearGradient>

          {/* Blue gradient (accent) */}
          <linearGradient id="bluePacket" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style={{ stopColor: "var(--info-border)" }} />
            <stop offset="100%" style={{ stopColor: "var(--info-light)" }} />
          </linearGradient>
        </defs>

        {/* Pipe bodies */}
        {PIPES.map((d, i) => (
          <path
            key={`pipe-${i}`}
            d={d}
            fill="none"
            className="stroke-white/5"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}

        {/* Pipe joints / elbows — slightly brighter */}
        {JOINTS.map(([cx, cy], i) => (
          <circle
            key={`joint-${i}`}
            cx={cx}
            cy={cy}
            r={4}
            className="fill-white/8"
          />
        ))}

        {/* Fluid packets (hidden when user prefers reduced motion) */}
        {!prefersReduced &&
          PACKETS.map(({ pipe, duration, delay, color, mobileHidden }, i) => (
            <path
              key={`packet-${i}`}
              className={`pipe-packet${mobileHidden ? " pipe-packet-mobile-hide" : ""}`}
              d={PIPES[pipe]}
              pathLength={1}
              fill="none"
              stroke={`url(#${color === "blue" ? "bluePacket" : "orangePacket"})`}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray="0.08 0.92"
              filter="url(#pipeGlow)"
              style={{
                animation: `pipeFlow ${duration}s linear ${delay}s infinite`,
              }}
            />
          ))}
      </svg>
    </div>
  );
}

/* ─── Right panel echo (light background) ─── */

const ECHO_PIPES: {
  d: string;
  color: "orange" | "blue";
  duration: number;
  delay: number;
  thin?: boolean;
}[] = [
  { d: "M -20 120 Q 80 120 80 200 Q 80 280 160 280 H 300", color: "orange", duration: 6, delay: 0 },
  { d: "M 600 -20 V 100 Q 600 140 640 140 H 820", color: "blue", duration: 5, delay: 1.5 },
  { d: "M 820 500 H 650 Q 620 500 620 530 V 700 Q 620 740 580 740 H 400", color: "orange", duration: 7, delay: 0.5 },
  { d: "M 200 820 V 680 Q 200 650 230 650 H 380", color: "blue", duration: 5.5, delay: 2, thin: true },
];

const ECHO_DOTS: { cx: number; cy: number; r: number; delay: string }[] = [
  { cx: 80, cy: 200, r: 3.5, delay: "0s" },
  { cx: 600, cy: 100, r: 3.5, delay: "-1s" },
  { cx: 620, cy: 530, r: 3.5, delay: "-2s" },
  { cx: 200, cy: 680, r: 3.5, delay: "-1.5s" },
  { cx: 160, cy: 280, r: 3, delay: "-0.5s" },
  { cx: 640, cy: 140, r: 3, delay: "-2.5s" },
];

/** Decorative echo of the brand-panel network behind the login form. */
export function LoginPipeEcho() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 800 800"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="rightOrangeFlow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: "var(--brand-orange)" }} />
          <stop offset="100%" style={{ stopColor: "var(--brand-orange-light)" }} />
        </linearGradient>
        <linearGradient id="rightBlueFlow" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: "var(--info)" }} />
          <stop offset="100%" style={{ stopColor: "var(--info-border)" }} />
        </linearGradient>
      </defs>

      {ECHO_PIPES.map(({ d, color, duration, delay, thin }) => (
        <g key={d}>
          <path
            d={d}
            fill="none"
            className={thin ? "stroke-primary/5" : "stroke-primary/7"}
            strokeWidth={thin ? 2 : 2.5}
            strokeLinecap="round"
          />
          <path
            className="right-pipe-flow"
            d={d}
            pathLength={1}
            fill="none"
            stroke={`url(#${color === "blue" ? "rightBlueFlow" : "rightOrangeFlow"})`}
            strokeWidth={thin ? 1.5 : 2}
            strokeLinecap="round"
            strokeDasharray={thin ? "0.1 0.9" : "0.08 0.92"}
            style={{
              opacity: color === "orange" && delay === 0 ? 0.13 : 0.11,
              animation: `pipeFlow ${duration}s linear ${delay}s infinite`,
            }}
          />
        </g>
      ))}

      {/* Junction dots with pulse */}
      {ECHO_DOTS.map(({ cx, cy, r, delay }) => (
        <circle
          key={`${cx}-${cy}`}
          cx={cx}
          cy={cy}
          r={r}
          className="right-dot-pulse fill-primary"
          style={{ animationDelay: delay }}
        />
      ))}
    </svg>
  );
}
