import type { Metadata } from "next";
import Link from "next/link";

import { PolicySection, PublicPage } from "@/components/public/public-page";

export const metadata: Metadata = {
  title: { absolute: "Conditions d’utilisation — MergeOne · TIMAX" },
  description: "Conditions d’utilisation professionnelle de MergeOne, responsabilités, documents, accès Google Drive et contact TIMAX.",
};

export default function TermsPage() {
  return (
    <PublicPage>
      <article className="mx-auto max-w-3xl space-y-10">
        <header>
          <p className="mb-3 text-sm text-muted-foreground">MergeOne · TIMAX · Mise à jour le 29 octobre 2026</p>
          <h1 className="text-4xl font-bold tracking-tight">Conditions d’utilisation</h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">MergeOne est le service de préparation d’affaires et de chiffrage BTP proposé par TIMAX.</p>
        </header>
        <PolicySection title="Usage professionnel et accès">
          <p>Le service permet notamment de rassembler des documents, importer des DPGF, préparer des métrés, établir des devis et gérer des commandes. Vous utilisez un compte personnel au sein d’une entreprise ; son responsable gère les invitations et les droits des membres.</p>
          <p>Vous êtes responsable de la confidentialité de vos identifiants et de l’usage de votre compte. Signalez à TIMAX tout accès non autorisé. Les conditions commerciales ou contractuelles convenues séparément avec votre entreprise restent applicables.</p>
        </PolicySection>
        <PolicySection title="Documents et connexions externes">
          <p>Vous devez disposer des droits nécessaires pour charger, partager, importer ou faire analyser un document. L’ajout à une affaire peut rendre les éléments accessibles aux membres autorisés de l’entreprise. Vous conservez vos droits sur vos documents et autorisez leur traitement dans la mesure nécessaire aux fonctions utilisées.</p>
          <p>Google Drive est facultatif. La connexion commence en lecture ; l’écriture requiert une activation supplémentaire et la sélection des fichiers concernés. MergeOne propose actuellement le commentaire et le renommage. Les restrictions Google et vos droits sur les fichiers continuent de s’appliquer.</p>
          <p>Les effets du retrait d’une connexion, de la suppression de copies et des traitements IA sont détaillés dans la <Link className="text-primary underline" href="/confidentialite">politique de confidentialité</Link>.</p>
        </PolicySection>
        <PolicySection title="Vérifier les résultats avant utilisation">
          <p>Les données importées, classifications IA, quantités proposées et calculs doivent être contrôlés par un professionnel compétent. Vous vérifiez les sources, unités, hypothèses, prix et documents finaux avant toute validation, commande ou transmission à un tiers.</p>
          <p>Une proposition automatisée ne remplace pas la lecture des pièces contractuelles ni la validation des métrés et du devis.</p>
        </PolicySection>
        <PolicySection title="Disponibilité et usage autorisé">
          <p>Le service peut être interrompu pour maintenance ou en cas d’incident. Les fonctions dépendant de Google, de l’hébergeur ou d’un fournisseur d’IA dépendent aussi de leur disponibilité, de leurs limites et des autorisations actives.</p>
          <p>Il est interdit de contourner les contrôles d’accès, accéder aux données d’une autre entreprise sans autorisation, compromettre le service ou y déposer des contenus que vous n’êtes pas autorisé à traiter. TIMAX peut restreindre un accès en cas d’abus ou pour protéger les données, dans le respect des engagements contractuels et du droit applicable.</p>
        </PolicySection>
        <PolicySection title="Arrêter d’utiliser le service ou nous contacter">
          <p>Vous pouvez retirer votre compte Drive depuis votre profil. Pour fermer votre compte MergeOne ou demander une suppression de données, suivez la page <Link className="text-primary underline" href="/suppression-des-donnees">suppression des données</Link>. La fermeture d’un compte personnel ne supprime pas automatiquement les affaires partagées de l’entreprise.</p>
          <p>Contact TIMAX : <a className="text-primary underline" href="mailto:thannous@gmail.com">thannous@gmail.com</a>. Ces conditions peuvent évoluer ; leur date est indiquée en haut de page. Les engagements spécifiques conclus avec votre entreprise et les droits prévus par la loi restent applicables.</p>
        </PolicySection>
      </article>
    </PublicPage>
  );
}
