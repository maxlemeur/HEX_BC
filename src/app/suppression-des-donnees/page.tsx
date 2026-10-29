import type { Metadata } from "next";
import Link from "next/link";

import { PolicySection, PublicPage } from "@/components/public/public-page";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "Suppression des données et accès Drive — MergeOne · TIMAX" },
  description: "Comment déconnecter Google Drive, retirer ses autorisations ou demander à TIMAX la suppression de données et d’un compte MergeOne.",
};

export default function DataDeletionPage() {
  return (
    <PublicPage>
      <article className="mx-auto max-w-3xl space-y-10">
        <header>
          <p className="mb-3 text-sm text-muted-foreground">MergeOne · TIMAX · Mise à jour le 29 octobre 2026</p>
          <h1 className="text-4xl font-bold tracking-tight">Supprimer vos données ou déconnecter Drive</h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">Vous pouvez retirer l’accès à Google Drive indépendamment de votre compte MergeOne. La suppression des données partagées d’une entreprise constitue une demande distincte.</p>
        </header>
        <PolicySection title="Retirer l’écriture ou le compte Drive">
          <ol className="list-decimal space-y-2 pl-6">
            <li>Ouvrez votre profil dans MergeOne, puis la section Google Drive.</li>
            <li>Choisissez « Revenir à la lecture seule » pour désactiver les écritures dans MergeOne, ou « Retirer le compte Google » pour supprimer cette connexion et ses jetons.</li>
            <li>Pour révoquer aussi le consentement chez Google, ouvrez les <a className="text-primary underline" href="https://myaccount.google.com/permissions">applications autorisées de votre compte Google</a>, choisissez MergeOne et retirez son accès. Cela peut interrompre les autres connexions de ce même compte à MergeOne.</li>
          </ol>
          <p>Le retrait du compte ne supprime pas les fichiers originaux dans Google Drive. Les liens, copies de travail, données extraites et devis déjà présents dans les affaires restent dans l’entreprise jusqu’à leur suppression distincte.</p>
        </PolicySection>
        <PolicySection title="Retirer une pièce d’une affaire">
          <p>Un membre habilité peut retirer un lien ou supprimer une copie depuis le dossier de l’affaire, après la fin des traitements en cours. Les données déjà intégrées à un DPGF, un métré, un historique ou un devis peuvent nécessiter une suppression séparée. Précisez ces éléments dans votre demande si vous souhaitez un effacement plus large.</p>
        </PolicySection>
        <PolicySection title="Demander la suppression d’un compte ou de données">
          <p>Envoyez votre demande à TIMAX depuis l’adresse de votre compte. Indiquez l’entreprise concernée et si vous demandez la suppression du compte personnel, de certains documents ou de l’espace de l’entreprise. Ne joignez ni mot de passe, ni jeton Google, ni documents sensibles inutiles à la demande.</p>
          <p>La demande est traitée manuellement après vérification de votre identité et de votre habilitation, avec un objectif de traitement sous 30 jours. La suppression d’un compte personnel n’entraîne pas celle des affaires collectives ; la fermeture d’une entreprise nécessite l’intervention de son responsable.</p>
          <p>Les obligations de conservation et les délais des sauvegardes sont expliqués dans la <Link className="text-primary underline" href="/confidentialite">politique de confidentialité</Link>. TIMAX vous indique ce qui a été supprimé, ce qui doit être conservé et le délai applicable.</p>
          <a className={buttonVariants({ className: "h-auto whitespace-normal text-center" })} href="mailto:thannous@gmail.com?subject=MergeOne%20-%20demande%20de%20suppression%20des%20donn%C3%A9es">Demander la suppression de mes données</a>
        </PolicySection>
      </article>
    </PublicPage>
  );
}
