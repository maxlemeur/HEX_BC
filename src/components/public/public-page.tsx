import Link from "next/link";
import type { ReactNode } from "react";

import { LegalLinks } from "@/components/public/legal-links";
import { buttonVariants } from "@/components/ui/button";

export function PublicPage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-surface-subtle text-foreground">
      <a className="sr-only fixed! left-3 top-3 z-[70] rounded-lg bg-surface text-primary shadow-lg focus:not-sr-only focus:p-4" href="#public-content">Aller au contenu</a>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link href="/" aria-label="MergeOne par TIMAX — accueil" className="flex items-baseline gap-3">
            <span className="text-2xl font-bold tracking-tight text-brand-blue">MergeOne</span>
            <span className="text-xs font-semibold text-muted-foreground">par TIMAX</span>
          </Link>
          <nav aria-label="Accès à MergeOne" className="flex items-center gap-3">
            <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>Connexion</Link>
            <Link href="/signup" className={buttonVariants({ size: "sm" })}>Créer un compte</Link>
          </nav>
        </div>
      </header>
      <main id="public-content" className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-20">
        {children}
      </main>
      <footer className="border-t border-border bg-surface px-5 py-8">
        <p className="mb-4 text-center text-sm text-muted-foreground">MergeOne, une application de TIMAX.</p>
        <LegalLinks />
      </footer>
    </div>
  );
}

export function PolicySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 text-base leading-7 text-muted-foreground">{children}</div>
    </section>
  );
}
