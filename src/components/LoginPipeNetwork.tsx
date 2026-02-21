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
        className="h-full w-full"
        preserveAspectRatio="xMidYMid slice"
        style={{ transition: "transform 0.3s ease-out" }}
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
            <stop offset="0%" stopColor="#E8732F" />
            <stop offset="100%" stopColor="#f5945a" />
          </linearGradient>

          {/* Blue gradient (accent) */}
          <linearGradient id="bluePacket" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>

        {/* Pipe bodies */}
        {PIPES.map((d, i) => (
          <path
            key={`pipe-${i}`}
            d={d}
            fill="none"
            stroke="rgba(255,255,255,0.05)"
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
            fill="rgba(255,255,255,0.08)"
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
