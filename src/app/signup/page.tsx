"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { TimaxMark, TimaxWordmark } from "@/components/brand/timax-logo";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/** Messages Supabase Auth (anglais) → français ; repli sur le message d'origine. */
function toFrenchSignupError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("already registered") || normalized.includes("already exists")) {
    return "Un compte existe déjà pour cet email. Connectez-vous ou réinitialisez votre mot de passe.";
  }
  if (normalized.includes("password should be") || normalized.includes("weak password")) {
    return "Mot de passe trop faible. Choisissez un mot de passe plus long ou plus varié.";
  }
  if (normalized.includes("invalid") && normalized.includes("email")) {
    return "Adresse email invalide.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many requests")) {
    return "Trop de tentatives. Patientez quelques minutes avant de réessayer.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "Connexion au service impossible. Vérifiez votre réseau et réessayez.";
  }
  return message;
}

export default function SignupPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    setLoading(false);

    if (signUpError) {
      setError(toFrenchSignupError(signUpError.message));
      return;
    }

    if (data.user && !data.session) {
      setSuccess(
        "Compte créé. Ouvrez le lien de confirmation reçu par email, puis connectez-vous."
      );
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-subtle px-4 py-12 sm:px-6 sm:py-16">
      <p className="mb-6 flex items-center gap-3 text-2xl text-foreground">
        <TimaxMark />
        <TimaxWordmark />
      </p>

      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 shadow-card sm:p-8">
        <h1 className="typo-h1 text-foreground">Créer un compte</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Utilisez votre email professionnel pour créer votre accès.
        </p>

        <form className="mt-8 space-y-5" method="post" onSubmit={onSubmit}>
          <Field>
            <FieldLabel htmlFor="signup-email">Email</FieldLabel>
            <Input
              id="signup-email"
              autoComplete="email"
              inputMode="email"
              name="email"
              placeholder="prenom.nom@entreprise.fr"
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="signup-password">Mot de passe</FieldLabel>
            <Input
              id="signup-password"
              autoComplete="new-password"
              name="password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>

          {error ? (
            <Alert variant="danger">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {success ? (
            <Alert variant="success">
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          ) : null}

          <Button className="w-full" size="lg" loading={loading} type="submit">
            Créer le compte
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Déjà un compte ?{" "}
          <Link
            className="font-semibold text-primary underline-offset-4 hover:underline"
            href="/login"
          >
            Se connecter
          </Link>
        </p>
      </div>
    </main>
  );
}
