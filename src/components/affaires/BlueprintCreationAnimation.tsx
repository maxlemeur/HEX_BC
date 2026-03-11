"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

type BlueprintCreationAnimationProps = {
  projectName: string;
  onComplete: () => void;
};

// Plan technique SVG paths (architecture/maison)
const PLAN_PATHS = [
  // Cadre extérieur
  "M100,100 L700,100 L700,500 L100,500 Z",
  // Murs intérieurs
  "M300,100 L300,500",
  "M100,300 L300,300",
  "M500,100 L500,300 L700,300",
  "M500,200 L700,200",
  // Lignes de cotes (mesures)
  "M100,60 L700,60",
  "M100,50 L100,70",
  "M700,50 L700,70",
  "M60,100 L60,500",
  "M50,100 L70,100",
  "M50,500 L70,500",
  // Portes / ouvertures (arcs)
  "M300,150 A50,50 0 0,1 350,100",
  "M300,100 L350,100",
  "M500,350 A50,50 0 0,0 450,300",
  "M450,300 L500,300",
  // Croix techniques aux coins
  "M90,90 L110,110",
  "M90,110 L110,90",
  "M690,90 L710,110",
  "M690,110 L710,90",
  "M90,490 L110,510",
  "M90,510 L110,490",
  "M690,490 L710,510",
  "M690,510 L710,490",
];

export function BlueprintCreationAnimation({
  projectName,
  onComplete,
}: BlueprintCreationAnimationProps) {
  const [stage, setStage] = useState<1 | 2 | 3>(1);

  const writeDurationSecs = Math.max(projectName.length * 0.15, 1);

  useEffect(() => {
    // Stage 1: Drawing plan (~2.5s)
    const t1 = setTimeout(() => setStage(2), 2500);
    return () => clearTimeout(t1);
  }, []);

  useEffect(() => {
    if (stage === 2) {
      // Stage 2: Writing project name
      const writeDuration = Math.max(projectName.length * 150, 1000) + 500;
      const t = setTimeout(() => setStage(3), writeDuration);
      return () => clearTimeout(t);
    }
    if (stage === 3) {
      // Stage 3: Checkmark then redirect
      const t = setTimeout(onComplete, 1800);
      return () => clearTimeout(t);
    }
  }, [stage, projectName, onComplete]);

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Blueprint grid background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "#f0f9ff",
          backgroundImage: [
            "linear-gradient(rgba(186,230,253,0.6) 1px, transparent 1px)",
            "linear-gradient(90deg, rgba(186,230,253,0.6) 1px, transparent 1px)",
            "linear-gradient(rgba(125,211,252,0.5) 2px, transparent 2px)",
            "linear-gradient(90deg, rgba(125,211,252,0.5) 2px, transparent 2px)",
          ].join(","),
          backgroundSize:
            "20px 20px, 20px 20px, 100px 100px, 100px 100px",
          backgroundPosition:
            "-1px -1px, -1px -1px, -2px -2px, -2px -2px",
        }}
      />

      {/* Plan technique animé */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="relative w-full max-w-4xl" style={{ aspectRatio: "4/3" }}>
          {/* Lignes du plan */}
          <svg
            viewBox="0 0 800 600"
            className="w-full h-full drop-shadow-sm"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: "var(--brand-blue)", opacity: 0.8 }}
          >
            {PLAN_PATHS.map((path, index) => (
              <motion.path
                key={index}
                d={path}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{
                  duration: 1.5,
                  ease: "easeInOut",
                  delay: index * 0.05,
                }}
              />
            ))}
          </svg>

          {/* Nom du projet + crayon (stage 2+) */}
          <AnimatePresence>
            {stage >= 2 && (
              <div className="absolute top-[30%] left-[15%] md:left-[20%] font-mono text-3xl md:text-5xl font-bold tracking-tight text-[var(--brand-blue-dark)]">
                <span className="relative inline-block py-2">
                  {/* Texte révélé par clip-path */}
                  <motion.span
                    className="block"
                    initial={{ clipPath: "inset(0 100% 0 0)" }}
                    animate={{ clipPath: "inset(0 0% 0 0)" }}
                    transition={{
                      duration: writeDurationSecs,
                      ease: "linear",
                    }}
                  >
                    {projectName}
                  </motion.span>

                  {/* Crayon animé */}
                  {stage === 2 && (
                    <motion.div
                      className="absolute -top-8 -right-8 text-[var(--brand-blue)] drop-shadow-md z-20"
                      initial={{ left: "0%", opacity: 0 }}
                      animate={{
                        left: "100%",
                        opacity: [0, 1, 1, 0],
                        y: [0, -4, 3, -2, 5, -3, 2, 0],
                        rotate: [-5, 5, -2, 6, -4, 3, 0],
                      }}
                      transition={{
                        left: {
                          duration: writeDurationSecs,
                          ease: "linear",
                        },
                        opacity: {
                          times: [0, 0.05, 0.95, 1],
                          duration: writeDurationSecs,
                        },
                        y: {
                          repeat: Infinity,
                          duration: 0.15,
                          ease: "easeInOut",
                        },
                        rotate: {
                          repeat: Infinity,
                          duration: 0.2,
                          ease: "easeInOut",
                        },
                      }}
                    >
                      <svg
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        stroke="white"
                        strokeWidth="1"
                        className="-scale-x-100 -rotate-45 origin-bottom-left"
                      >
                        <path d="M21.17 3.25q.33.33.33.8t-.33.8l-1.5 1.5-3.34-3.34 1.5-1.5q.33-.33.8-.33t.8.33l1.74 1.74zM3 17.25v3.34h3.34l10.8-10.8-3.34-3.34L3 17.25z" />
                      </svg>
                    </motion.div>
                  )}
                </span>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Checkmark de validation (stage 3) */}
      <AnimatePresence>
        {stage === 3 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-white/60 backdrop-blur-sm z-30"
          >
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", bounce: 0.5 }}
              className="rounded-full bg-white p-8 shadow-2xl border-4 border-green-50"
            >
              <svg
                width="120"
                height="120"
                viewBox="0 0 100 100"
                className="text-[var(--success)]"
              >
                <motion.circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="6"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
                <motion.path
                  d="M 30 50 L 45 65 L 70 35"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.5, delay: 0.4 }}
                />
              </svg>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status text */}
      <div className="absolute bottom-[15%] left-0 right-0 flex justify-center z-20">
        <AnimatePresence mode="wait">
          {stage !== 3 ? (
            <motion.p
              key="creating"
              className="rounded-full bg-white/80 px-6 py-2.5 text-sm font-medium text-[var(--slate-600)] shadow-sm backdrop-blur-sm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              Creation de l&apos;affaire…
            </motion.p>
          ) : (
            <motion.p
              key="done"
              className="rounded-full bg-white/80 px-6 py-2.5 text-sm font-semibold text-[var(--success)] shadow-sm backdrop-blur-sm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              Affaire creee !
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
