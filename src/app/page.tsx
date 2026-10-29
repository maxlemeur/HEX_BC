import type { Metadata } from "next";
import Link from "next/link";

import { PublicPage } from "@/components/public/public-page";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  verification: { google: "v08Yf958dOzMjpttQotSTl2wOa0YZNxnAlqRtPRDTVU" },
  title: { absolute: "MergeOne — chiffrage BTP par TIMAX" },
  description: "Préparez vos affaires, importez vos DPGF et plans, construisez vos devis et retrouvez vos documents Google Drive dans MergeOne, une application de TIMAX.",
};

export default function HomePage() {
  return (
    <PublicPage>
      <section className="grid items-start gap-12 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <p className="mb-5 text-sm font-semibold uppercase tracking-widest text-brand-orange">Chiffrage BTP · MergeOne</p>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">Vos affaires, du dossier au devis.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
            MergeOne réunit les documents de vos affaires, les DPGF, les plans et le chiffrage dans un même espace de travail. Une application de TIMAX pour les entreprises du bâtiment et les bureaux d’études.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className={buttonVariants({ size: "lg" })}>Ouvrir MergeOne</Link>
            <Link href="#google-drive" className={buttonVariants({ variant: "outline", size: "lg" })}>Comprendre l’accès Google Drive</Link>
          </div>
        </div>
        <aside aria-label="Votre parcours dans MergeOne" className="rounded-2xl border border-border bg-surface p-7 sm:p-9">
          <h2 className="text-lg font-semibold">Un dossier, une progression claire</h2>
          <ol className="mt-6 space-y-6 text-muted-foreground">
            <li><strong className="block text-foreground">01 · Rassembler</strong>Ajoutez vos documents et reliez les fichiers Drive utiles à l’affaire.</li>
            <li><strong className="block text-foreground">02 · Structurer</strong>Importez le DPGF et vérifiez les lignes, les unités et les quantités.</li>
            <li><strong className="block text-foreground">03 · Chiffrer et vérifier</strong>Préparez vos métrés et vos prix, puis contrôlez le devis avant sa diffusion.</li>
          </ol>
        </aside>
      </section>
      <section id="google-drive" className="mt-20 scroll-mt-8 border-t border-border pt-12">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand-orange">Connexion facultative</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">Votre Google Drive, avec les droits que vous choisissez.</h2>
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <article className="rounded-2xl border border-border bg-surface p-7">
            <h3 className="text-xl font-semibold">La lecture par défaut</h3>
            <p className="mt-3 leading-7 text-muted-foreground">Connectez un compte Google depuis votre profil pour parcourir les dossiers et choisir les documents à lier ou à importer. L’autorisation de lecture porte sur l’ensemble du Drive accessible à ce compte. MergeOne traite les fichiers que vous choisissez pour vos affaires.</p>
          </article>
          <article className="rounded-2xl border border-border bg-surface p-7">
            <h3 className="text-xl font-semibold">L’écriture, si vous l’activez</h3>
            <p className="mt-3 leading-7 text-muted-foreground">Une autorisation supplémentaire permet de commenter ou de renommer les fichiers que vous sélectionnez avec Google Picker, selon vos droits sur ces fichiers. Vous pouvez revenir à la lecture seule ou retirer votre compte depuis votre profil.</p>
          </article>
        </div>
        <p className="mt-6 max-w-4xl leading-7 text-muted-foreground">Les liens, données extraites et copies de travail nécessaires à l’import ou au métré sont conservés dans l’affaire et accessibles aux membres autorisés de votre entreprise. Les fonctions d’analyse peuvent transmettre les documents ou leurs extraits au service d’IA configuré. Consultez notre <Link className="font-medium text-primary underline" href="/confidentialite">politique de confidentialité</Link> avant de connecter votre compte.</p>
      </section>
      <section className="mt-16 border-t border-border pt-10">
        <h2 className="text-xl font-semibold">Une question sur MergeOne ou vos données ?</h2>
        <p className="mt-3 text-muted-foreground">Contactez TIMAX à <a className="text-primary underline" href="mailto:thannous@gmail.com">thannous@gmail.com</a>.</p>
      </section>
    </PublicPage>
  );
}
