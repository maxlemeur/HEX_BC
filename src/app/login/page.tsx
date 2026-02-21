"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import LoginPipeNetwork from "@/components/LoginPipeNetwork";

/* ─── Animation variants ─── */

const brandPanelVariants = {
  hidden: (reduced: boolean) => ({
    opacity: 0,
    x: reduced ? 0 : -40,
  }),
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const brandContentVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const brandItemVariants = {
  hidden: (reduced: boolean) => ({
    opacity: 0,
    y: reduced ? 0 : 20,
  }),
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const formPanelVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.4, delay: 0.2 },
  },
};

const formContainerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.5 },
  },
};

const formItemVariants = {
  hidden: (reduced: boolean) => ({
    opacity: 0,
    y: reduced ? 0 : 16,
  }),
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const errorVariants = {
  hidden: { opacity: 0, height: 0, marginTop: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    marginTop: 16,
    x: [0, -8, 8, -4, 4, 0],
    transition: { duration: 0.4, x: { duration: 0.4, ease: "easeOut" } },
  },
  exit: {
    opacity: 0,
    height: 0,
    marginTop: 0,
    transition: { duration: 0.2 },
  },
};

/* ─── Feature bullets ─── */

const features = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
        <path d="M8 10h8" /><path d="M8 14h4" />
      </svg>
    ),
    text: "Chiffrage projet, devis et bons de commande en quelques clics",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" />
      </svg>
    ),
    text: "Import DPGF, prix fournisseurs et indices matière automatisés",
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
        <path d="M21 12H11" /><path d="M21 16H11" /><path d="M21 20H11" />
        <rect x="7" y="12" width="4" height="8" rx="1" />
      </svg>
    ),
    text: "Export Excel multi-feuilles, PDF et suivi temps réel",
  },
];

/* ─── Component ─── */

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const prefersReduced = useReducedMotion();
  const reduced = !!prefersReduced;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (signInError) {
      setError(signInError.message);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* ───────── LEFT PANEL — Brand ───────── */}
      <motion.div
        custom={reduced}
        variants={brandPanelVariants}
        initial="hidden"
        animate="visible"
        className="relative flex w-full flex-col justify-center overflow-hidden bg-gradient-to-br from-[#1E3A5F] via-[#1a3355] to-[#152a45] px-8 py-12 text-white sm:px-12 lg:w-[45%] lg:min-h-screen lg:px-16 lg:py-20"
      >
        {/* Animated pipe network background */}
        <LoginPipeNetwork />

        {/* Dark scrim — improves text legibility over pipes */}
        <div className="absolute inset-0 z-[1] bg-gradient-to-r from-[rgba(21,42,69,0.85)] via-[rgba(21,42,69,0.6)] to-[rgba(21,42,69,0.3)]" />

        {/* Brand content */}
        <motion.div
          variants={brandContentVariants}
          initial="hidden"
          animate="visible"
          className="relative z-10"
          style={{ textShadow: "0 1px 6px rgba(0,0,0,0.4)" }}
        >
          {/* Logo */}
          <motion.div custom={reduced} variants={brandItemVariants} className="mb-6 lg:mb-8">
            <div className="inline-flex h-14 w-32 items-center justify-center overflow-hidden rounded-2xl bg-white/95 p-2 shadow-lg shadow-black/10 lg:h-16 lg:w-40 lg:rounded-3xl">
              <Image
                src="/logo-hydro-express.jpg"
                alt="Hydro Express"
                width={160}
                height={70}
                className="h-full w-full object-contain"
                priority
              />
            </div>
          </motion.div>

          {/* Brand name */}
          <motion.h1
            custom={reduced}
            variants={brandItemVariants}
            className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl"
          >
            TIMAX
          </motion.h1>

          {/* Tagline */}
          <motion.p
            custom={reduced}
            variants={brandItemVariants}
            className="mt-2 text-sm font-medium text-white/80 sm:text-base lg:mt-3 lg:text-lg"
          >
            Chiffrage et gestion des commandes
          </motion.p>

          {/* Separator */}
          <motion.div
            custom={reduced}
            variants={brandItemVariants}
            className="mt-6 h-1 w-16 rounded-full bg-gradient-to-r from-[#E8732F] to-[#E8732F]/40 lg:mt-8 lg:w-20"
          />

          {/* Feature bullets — hidden on tablet, shown on desktop */}
          <div className="mt-8 hidden space-y-4 lg:block">
            {features.map((feature, i) => (
              <motion.div
                key={i}
                custom={reduced}
                variants={brandItemVariants}
                className="flex items-center gap-3 text-sm text-white/90"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-white/10">
                  {feature.icon}
                </span>
                <span>{feature.text}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </motion.div>

      {/* ───────── RIGHT PANEL — Form ───────── */}
      <motion.div
        variants={formPanelVariants}
        initial="hidden"
        animate="visible"
        className="relative flex w-full flex-1 items-center justify-center overflow-hidden bg-[#f8fafc] px-6 py-12 sm:px-10 lg:w-[55%] lg:px-16"
      >
        {/* Decorative pipe fragments — animated echo of left panel */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 800 800"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="rightOrangeFlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#E8732F" />
              <stop offset="100%" stopColor="#f5945a" />
            </linearGradient>
            <linearGradient id="rightBlueFlow" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#60a5fa" />
            </linearGradient>
          </defs>

          {/* ── Pipe 1: top-left curve ── */}
          <path
            d="M -20 120 Q 80 120 80 200 Q 80 280 160 280 H 300"
            fill="none" stroke="rgba(30,58,95,0.07)" strokeWidth="2.5" strokeLinecap="round"
          />
          <path
            className="right-pipe-flow"
            d="M -20 120 Q 80 120 80 200 Q 80 280 160 280 H 300"
            pathLength={1} fill="none" stroke="url(#rightOrangeFlow)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="0.08 0.92" style={{ opacity: 0.13, animation: "pipeFlow 6s linear 0s infinite" }}
          />

          {/* ── Pipe 2: top-right drop ── */}
          <path
            d="M 600 -20 V 100 Q 600 140 640 140 H 820"
            fill="none" stroke="rgba(30,58,95,0.07)" strokeWidth="2.5" strokeLinecap="round"
          />
          <path
            className="right-pipe-flow"
            d="M 600 -20 V 100 Q 600 140 640 140 H 820"
            pathLength={1} fill="none" stroke="url(#rightBlueFlow)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="0.08 0.92" style={{ opacity: 0.11, animation: "pipeFlow 5s linear 1.5s infinite" }}
          />

          {/* ── Pipe 3: right side descent ── */}
          <path
            d="M 820 500 H 650 Q 620 500 620 530 V 700 Q 620 740 580 740 H 400"
            fill="none" stroke="rgba(30,58,95,0.07)" strokeWidth="2.5" strokeLinecap="round"
          />
          <path
            className="right-pipe-flow"
            d="M 820 500 H 650 Q 620 500 620 530 V 700 Q 620 740 580 740 H 400"
            pathLength={1} fill="none" stroke="url(#rightOrangeFlow)" strokeWidth="2" strokeLinecap="round"
            strokeDasharray="0.08 0.92" style={{ opacity: 0.11, animation: "pipeFlow 7s linear 0.5s infinite" }}
          />

          {/* ── Pipe 4: bottom-left rise ── */}
          <path
            d="M 200 820 V 680 Q 200 650 230 650 H 380"
            fill="none" stroke="rgba(30,58,95,0.055)" strokeWidth="2" strokeLinecap="round"
          />
          <path
            className="right-pipe-flow"
            d="M 200 820 V 680 Q 200 650 230 650 H 380"
            pathLength={1} fill="none" stroke="url(#rightBlueFlow)" strokeWidth="1.5" strokeLinecap="round"
            strokeDasharray="0.1 0.9" style={{ opacity: 0.11, animation: "pipeFlow 5.5s linear 2s infinite" }}
          />

          {/* Junction dots with pulse */}
          <circle cx="80" cy="200" r="3.5" fill="rgb(30,58,95)" className="right-dot-pulse" style={{ animationDelay: "0s" }} />
          <circle cx="600" cy="100" r="3.5" fill="rgb(30,58,95)" className="right-dot-pulse" style={{ animationDelay: "-1s" }} />
          <circle cx="620" cy="530" r="3.5" fill="rgb(30,58,95)" className="right-dot-pulse" style={{ animationDelay: "-2s" }} />
          <circle cx="200" cy="680" r="3.5" fill="rgb(30,58,95)" className="right-dot-pulse" style={{ animationDelay: "-1.5s" }} />
          <circle cx="160" cy="280" r="3" fill="rgb(30,58,95)" className="right-dot-pulse" style={{ animationDelay: "-0.5s" }} />
          <circle cx="640" cy="140" r="3" fill="rgb(30,58,95)" className="right-dot-pulse" style={{ animationDelay: "-2.5s" }} />
        </svg>

        <motion.form
          variants={formContainerVariants}
          initial="hidden"
          animate="visible"
          className="relative w-full max-w-md space-y-6"
          onSubmit={onSubmit}
        >
          {/* Heading */}
          <div>
            <motion.h1
              custom={reduced}
              variants={formItemVariants}
              className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
            >
              Connexion
            </motion.h1>
            <motion.p
              custom={reduced}
              variants={formItemVariants}
              className="mt-2 text-sm text-slate-500 sm:text-base"
            >
              Connectez-vous pour accéder au tableau de bord.
            </motion.p>
          </div>

          {/* Email */}
          <motion.label custom={reduced} variants={formItemVariants} className="block">
            <span className="text-sm font-semibold text-slate-700">Email</span>
            <motion.input
              whileFocus={{ scale: 1.01, boxShadow: "0 0 0 3px rgba(30,58,95,0.1)" }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition-colors hover:border-slate-300 focus:border-[#1E3A5F]"
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder="prenom.nom@entreprise.fr"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </motion.label>

          {/* Password */}
          <motion.label custom={reduced} variants={formItemVariants} className="block">
            <span className="text-sm font-semibold text-slate-700">Mot de passe</span>
            <div className="relative mt-2">
              <motion.input
                whileFocus={{ scale: 1.01, boxShadow: "0 0 0 3px rgba(30,58,95,0.1)" }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 pr-24 text-sm outline-none transition-colors hover:border-slate-300 focus:border-[#1E3A5F]"
                autoComplete="current-password"
                id="password"
                name="password"
                required
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                aria-controls="password"
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                aria-pressed={showPassword}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                type="button"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "Masquer" : "Afficher"}
              </button>
            </div>
          </motion.label>

          {/* Error */}
          <AnimatePresence mode="wait">
            {error && (
              <motion.p
                key="error"
                variants={errorVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                role="alert"
                aria-live="assertive"
                className="overflow-hidden rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          {/* Submit */}
          <motion.button
            custom={reduced}
            variants={formItemVariants}
            whileHover={{ scale: 1.02, backgroundColor: "#2d4a6f" }}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1E3A5F] text-sm font-semibold text-white shadow-lg shadow-[#1E3A5F]/20 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            disabled={loading}
            type="submit"
          >
            {loading ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Connexion en cours...
              </>
            ) : (
              "Se connecter"
            )}
          </motion.button>

          {/* Signup link */}
          <motion.p
            custom={reduced}
            variants={formItemVariants}
            className="text-center text-sm text-slate-500"
          >
            Pas de compte ?{" "}
            <Link
              className="font-semibold text-[#1E3A5F] transition-colors hover:text-[#E8732F] hover:underline"
              href="/signup"
            >
              Créer un compte
            </Link>
          </motion.p>
        </motion.form>
      </motion.div>
    </main>
  );
}
