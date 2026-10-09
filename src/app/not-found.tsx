import type { Metadata } from "next";
import Link from "next/link";

import { TimaxMark } from "@/components/brand/timax-logo";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page introuvable" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-16">
      <div className="flex max-w-md flex-col items-center text-center">
        <TimaxMark className="size-12 rounded-xl text-xl" />
        <p className="mt-6 font-mono text-sm font-semibold text-brand-orange-dark">404</p>
        <h1 className="typo-h1 mt-2 text-foreground">Page introuvable</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Cette adresse n’existe pas ou n’est plus disponible. Vérifiez le lien ou revenez à l’accueil.
        </p>
        <Link href="/dashboard" className={buttonVariants({ variant: "primary", size: "lg", className: "mt-8" })}>
          Revenir à l’accueil
        </Link>
      </div>
    </main>
  );
}
