"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { motion, AnimatePresence, MotionConfig, useReducedMotion } from "motion/react";
import { FileSpreadsheetIcon, FileUpIcon, ReceiptIcon } from "lucide-react";

import LoginPipeNetwork, { LoginPipeEcho } from "@/components/LoginPipeNetwork";
import { TimaxMark, TimaxWordmark } from "@/components/brand/timax-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/* ─── Animation variants ───
   Hidden states are static so the server and client render the same markup; for users who
   prefer reduced motion, MotionConfig reducedMotion="user" skips the slide and keeps the fade. */

const brandPanelVariants = {
  hidden: { opacity: 0, x: -40 },
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
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const },
  },
};

const errorVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    x: [0, -8, 8, -4, 4, 0],
    transition: { duration: 0.4, x: { duration: 0.4, ease: "easeOut" } },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.2 },
  },
};

const errorVariantsReduced = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
  exit: { opacity: 0 },
};

/** Messages Supabase Auth (anglais) → français ; repli sur le message d'origine. */
function toFrenchAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "Email ou mot de passe incorrect.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Adresse email non confirmée. Ouvrez le lien reçu par email, puis reconnectez-vous.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "Connexion au service impossible. Vérifiez votre réseau et réessayez.";
  }
  return message;
}

/* ─── Feature bullets ─── */

const features = [
  {
    Icon: ReceiptIcon,
    text: "Chiffrage d’affaires, devis et bons de commande en quelques clics",
  },
  {
    Icon: FileUpIcon,
    text: "Import DPGF, prix fournisseurs et indices matière automatisés",
  },
  {
    Icon: FileSpreadsheetIcon,
    text: "Export Excel multi-feuilles, PDF et suivi en temps réel",
  },
];

/* ─── Component ─── */

const hydrationStore = {
  subscribe: () => () => undefined,
  getSnapshot: () => true,
  getServerSnapshot: () => false,
};

export default function LoginPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const isHydrated = useSyncExternalStore(
    hydrationStore.subscribe,
    hydrationStore.getSnapshot,
    hydrationStore.getServerSnapshot,
  );
  // Only read for the error message, which never exists on the first render.
  const reduced = !!useReducedMotion();

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
      setError(toFrenchAuthError(signInError.message));
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex min-h-screen flex-col lg:flex-row">
        {/* ───────── LEFT PANEL — Brand ───────── */}
        <motion.div
          variants={brandPanelVariants}
          initial="hidden"
          animate="visible"
          className="relative flex w-full flex-col justify-center overflow-hidden bg-gradient-to-br from-brand-blue to-brand-blue-dark px-6 py-10 text-white sm:px-12 sm:py-12 lg:min-h-screen lg:w-[45%] lg:px-16 lg:py-20"
        >
          {/* Animated pipe network background */}
          <LoginPipeNetwork />

          {/* Dark scrim — improves text legibility over pipes */}
          <div
            aria-hidden="true"
            className="absolute inset-0 z-[1] bg-gradient-to-r from-brand-blue-dark/85 via-brand-blue-dark/60 to-brand-blue-dark/30"
          />

          {/* Brand content */}
          <motion.div
            variants={brandContentVariants}
            initial="hidden"
            animate="visible"
            className="relative z-10 [text-shadow:0_1px_6px_rgb(0_0_0/0.4)]"
          >
            {/* Brand — the page keeps a single h1: the form heading. */}
            <motion.p
              variants={brandItemVariants}
              className="flex items-center gap-3 text-2xl sm:text-3xl lg:text-4xl"
            >
              <TimaxMark className="size-10 text-xl lg:size-12 lg:text-2xl" />
              <TimaxWordmark />
            </motion.p>

            {/* Tagline */}
            <motion.p
              variants={brandItemVariants}
              className="mt-3 text-sm font-medium text-white/85 sm:text-base lg:text-lg"
            >
              Chiffrage BTP : affaires, métrés, devis et bons de commande
            </motion.p>

            {/* Separator */}
            <motion.div
              variants={brandItemVariants}
              aria-hidden="true"
              className="mt-6 h-1 w-16 rounded-full bg-gradient-to-r from-brand-orange-light to-brand-orange-light/40 lg:mt-8 lg:w-20"
            />

            {/* Feature bullets — hidden on tablet, shown on desktop */}
            <ul className="mt-8 hidden space-y-4 lg:block">
              {features.map(({ Icon, text }) => (
                <motion.li
                  key={text}
                  variants={brandItemVariants}
                  className="flex items-center gap-3 text-sm text-white/90"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span>{text}</span>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        </motion.div>

        {/* ───────── RIGHT PANEL — Form ───────── */}
        {/*
          Sans animation JS : le formulaire est visible et utilisable dès le HTML
          serveur, avant l'hydratation (le fondu est en CSS).
        */}
        <div className="relative flex w-full flex-1 items-start justify-center overflow-hidden bg-surface-subtle px-4 py-10 sm:px-10 sm:py-12 lg:w-[55%] lg:items-center lg:px-16">
          <LoginPipeEcho />

          <form
            className="relative w-full max-w-md space-y-6 animate-in fade-in-0 duration-500 motion-reduce:animate-none"
            method="post"
            onSubmit={onSubmit}
          >
            {/* Heading */}
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Connexion
              </h1>
              <p className="mt-2 text-sm text-muted-foreground sm:text-base">
                Connectez-vous pour accéder à votre espace.
              </p>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email" className="font-semibold text-foreground-secondary">
                Email
              </Label>
              <Input
                id="email"
                size="lg"
                className="h-12 bg-surface"
                autoComplete="email"
                inputMode="email"
                name="email"
                placeholder="prenom.nom@entreprise.fr"
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>

            {/* Password */}
            <div className="space-y-2">
              <Label htmlFor="password" className="font-semibold text-foreground-secondary">
                Mot de passe
              </Label>
              <div className="relative">
                <Input
                  size="lg"
                  className="h-12 bg-surface pr-24"
                  autoComplete="current-password"
                  id="password"
                  name="password"
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Button
                  aria-controls="password"
                  aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  aria-pressed={showPassword}
                  variant="ghost"
                  size="sm"
                  className="absolute top-1/2 right-2 -translate-y-1/2"
                  type="button"
                  disabled={!isHydrated}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "Masquer" : "Afficher"}
                </Button>
              </div>
            </div>

            {/* Error */}
            <AnimatePresence mode="wait">
              {error ? (
                <motion.p
                  key="error"
                  variants={reduced ? errorVariantsReduced : errorVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  role="alert"
                  className="overflow-hidden rounded-control border border-danger-border bg-danger-subtle px-4 py-3 text-sm font-medium text-danger"
                >
                  {error}
                </motion.p>
              ) : null}
            </AnimatePresence>

            {/* Submit */}
            <Button size="xl" className="w-full" loading={loading} type="submit">
              Se connecter
            </Button>

            {/* Signup link */}
            <p className="text-center text-sm text-muted-foreground">
              Pas de compte ?{" "}
              <Link
                className="font-semibold text-primary underline-offset-4 transition-colors hover:text-brand-orange-dark hover:underline"
                href="/signup"
              >
                Créer un compte
              </Link>
            </p>
          </form>
        </div>
      </main>
    </MotionConfig>
  );
}
