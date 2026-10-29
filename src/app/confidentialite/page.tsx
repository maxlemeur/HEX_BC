import type { Metadata } from "next";
import Link from "next/link";

import { PolicySection, PublicPage } from "@/components/public/public-page";

export const metadata: Metadata = {
  title: { absolute: "Politique de confidentialité — MergeOne · TIMAX" },
  description: "Données traitées par MergeOne, accès Google Drive, analyses IA, conservation, retrait des accès et demandes de suppression auprès de TIMAX.",
};

export default function PrivacyPage() {
  return (
    <PublicPage>
      <article className="mx-auto max-w-3xl space-y-10">
        <header>
          <p className="mb-3 text-sm text-muted-foreground">MergeOne · TIMAX · Mise à jour le 29 octobre 2026</p>
          <h1 className="text-4xl font-bold tracking-tight">Politique de confidentialité</h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">Cette politique explique comment MergeOne utilise vos données pour préparer vos affaires, importer vos documents et produire vos chiffrages.</p>
        </header>
        <PolicySection title="Qui traite vos données ?">
          <p>MergeOne est une application de TIMAX. TIMAX assure la gestion du service et des données de compte. Pour toute question ou demande relative à vos données, contactez <a className="text-primary underline" href="mailto:thannous@gmail.com">thannous@gmail.com</a>.</p>
          <p>Les documents et données métier sont gérés dans l’espace de votre entreprise. Votre entreprise détermine les affaires, les membres autorisés et les usages professionnels de ces documents ; TIMAX fournit les moyens techniques de leur traitement.</p>
        </PolicySection>
        <PolicySection title="Quelles données sont traitées ?">
          <ul className="list-disc space-y-2 pl-6">
            <li>Compte et profil : adresse e-mail, nom et, si vous les renseignez, fonction et téléphone ; appartenance à une entreprise et droits d’accès.</li>
            <li>Affaires : coordonnées professionnelles, pièces jointes, DPGF, plans, CCTP, quantités, prix, devis, commandes et historiques de travail.</li>
            <li>Connexion Google : identifiant du compte, nom, adresse e-mail, autorisations accordées et jetons nécessaires pour maintenir la connexion.</li>
            <li>Fichiers Drive sélectionnés : identifiants, noms, types, dates de modification, liens de provenance, contenu nécessaire au traitement et résultats extraits.</li>
            <li>Données techniques : événements de sécurité, erreurs et journaux nécessaires au fonctionnement et au diagnostic du service.</li>
          </ul>
        </PolicySection>
        <PolicySection title="Vos documents Google Drive">
          <p>La connexion Google Drive est facultative. Un seul compte Google peut être connecté à votre profil dans chaque entreprise active. Vous pouvez continuer à utiliser les autres fonctions de MergeOne sans connecter Drive.</p>
          <p><strong className="text-foreground">Lecture par défaut — <code>drive.readonly</code>.</strong> Google accorde la possibilité de consulter et télécharger les fichiers de l’ensemble du Drive accessible au compte. MergeOne utilise cet accès pour afficher les dossiers et fichiers, permettre votre sélection et lire les pièces choisies pour l’affaire. La connexion seule ne lance pas une importation de tous vos fichiers.</p>
          <p><strong className="text-foreground">Écriture optionnelle — <code>drive.file</code>.</strong> Lorsque vous activez l’écriture, Google autorise la gestion des fichiers que vous ouvrez ou partagez avec MergeOne via Google Picker. Cette autorisation Google inclut la création, la modification et la suppression de ces fichiers. MergeOne propose actuellement deux opérations explicites : ajouter un commentaire et renommer le fichier. L’accès reste limité par vos propres droits sur ce fichier.</p>
          <p>Un lien vers une pièce conserve sa provenance dans l’affaire. Sa lecture et son classement peuvent télécharger temporairement son contenu. L’import structuré du DPGF et la préparation d’un plan pour le métré peuvent conserver une copie de travail ainsi que les données extraites. Les membres autorisés de l’entreprise peuvent accéder à ces données partagées dans MergeOne, y compris lorsqu’ils ne disposent pas personnellement du même accès dans Google Drive.</p>
          <p>Le retour à la lecture seule désactive les opérations d’écriture dans MergeOne. Le retrait du compte supprime les jetons conservés pour cette connexion, sans supprimer automatiquement les affaires, liens ou copies déjà créés. La révocation dans Google peut affecter les autres connexions de ce même compte à MergeOne. La marche à suivre figure sur la page <Link className="text-primary underline" href="/suppression-des-donnees">suppression et déconnexion</Link>.</p>
        </PolicySection>
        <PolicySection title="Analyses assistées par IA">
          <p>Le classement des pièces, la préparation du brief et les analyses de plans peuvent utiliser une assistance IA. Lorsque vous ajoutez une pièce à un parcours qui comporte cette analyse ou lancez une analyse, les éléments nécessaires peuvent être transmis au fournisseur configuré : Google pour Gemini ou OpenAI pour les fonctions OpenAI/ChatGPT disponibles. Il peut s’agir du nom du document, d’extraits, de pages ou du fichier utile à l’analyse, ainsi que des instructions et du contexte de l’affaire.</p>
          <p>Les fournisseurs interviennent pour fournir le résultat demandé. TIMAX n’utilise pas les données provenant de Google Drive pour entraîner des modèles d’IA généralistes. Les conditions de traitement du fournisseur et, pour une connexion personnelle, les paramètres du compte associé s’appliquent également. N’ajoutez à une affaire que des documents dont vous pouvez autoriser ce traitement.</p>
          <p>Les propositions automatiques et les données extraites doivent être vérifiées par un utilisateur avant validation d’un chiffrage ou d’une décision métier.</p>
        </PolicySection>
        <PolicySection title="Finalités et destinataires">
          <p>Les données servent à gérer l’accès au service, organiser les affaires, importer et analyser les documents choisis, calculer et produire les devis, permettre le travail d’équipe et sécuriser le service. Les traitements nécessaires au service reposent sur sa fourniture et sur les instructions de votre entreprise ; les connexions facultatives reposent sur les autorisations que vous accordez et pouvez retirer.</p>
          <p>Les données sont accessibles aux personnes autorisées dans votre entreprise et aux prestataires techniques nécessaires : Vercel pour l’hébergement applicatif, Supabase pour l’authentification, la base de données et le stockage, Google pour Drive/Picker et, lorsqu’ils sont utilisés, les fournisseurs d’IA décrits ci-dessus. Fontshare peut recevoir les données techniques de connexion nécessaires au chargement des polices de l’interface. Les destinataires auxquels vous envoyez un devis ou partagez un accès reçoivent les éléments que vous choisissez de leur communiquer.</p>
          <p>Les prestataires peuvent traiter des données hors de votre pays. Les lieux de traitement et les garanties applicables dépendent du service utilisé ; vous pouvez demander ces informations à TIMAX. Aucun engagement d’hébergement exclusivement français ou européen n’est pris ici.</p>
        </PolicySection>
        <PolicySection title="Utilisation limitée des données Google">
          <p>L’utilisation et le transfert par MergeOne des informations reçues des API Google respectent les <a className="text-primary underline" href="https://developers.google.com/terms/api-services-user-data-policy">règles Google API Services User Data Policy</a>, y compris leurs exigences d’utilisation limitée (« Limited Use »).</p>
          <p>Ces données ne sont ni vendues, ni utilisées pour le ciblage publicitaire ou le profilage commercial. Elles servent aux fonctionnalités visibles de MergeOne que vous utilisez. Leur transmission est limitée aux traitements nécessaires à ces fonctions avec votre autorisation, à la sécurité et aux obligations légales. L’accès humain par l’assistance nécessite votre accord sur les éléments concernés, sauf nécessité de sécurité ou obligation légale.</p>
        </PolicySection>
        <PolicySection title="Conservation et suppression">
          <p>Les données de compte sont conservées pendant l’utilisation du service. Les affaires, documents et résultats restent dans l’espace de l’entreprise tant qu’ils sont nécessaires à son activité ou à ses obligations ; retirer un membre ou déconnecter Drive ne supprime pas cet espace partagé.</p>
          <p>Les demandes de suppression ou d’anonymisation du compte personnel sont traitées manuellement après vérification de l’identité, avec un objectif de traitement sous 30 jours. La fermeture de l’espace d’une entreprise fait l’objet d’une demande distincte de son responsable. Les éléments soumis à une obligation de conservation ou nécessaires à un litige peuvent être conservés séparément pendant la durée requise, qui est alors expliquée au demandeur.</p>
          <p>Une suppression du stockage actif n’efface pas immédiatement les sauvegardes existantes. TIMAX retient un objectif d’expiration de ces copies sous 30 jours ; la vérification et l’application de cette durée chez les prestataires restent à finaliser. Il ne s’agit donc pas d’une garantie d’effacement technique de toutes les sauvegardes à ce jour. Le délai applicable à votre demande vous est communiqué lors de son traitement.</p>
        </PolicySection>
        <PolicySection title="Sécurité et cookies">
          <p>MergeOne contrôle les accès par compte, appartenance à l’entreprise et rôle. Les jetons de renouvellement Google sont chiffrés côté serveur ; les communications utilisent HTTPS en production. Aucune mesure ne permet toutefois de garantir une absence absolue d’incident.</p>
          <p>Des cookies et mécanismes de stockage nécessaires à l’authentification, à la sécurité et aux préférences de l’interface sont utilisés. MergeOne n’utilise pas les données Google pour la publicité.</p>
        </PolicySection>
        <PolicySection title="Vos droits et vos demandes">
          <p>Vous pouvez demander l’accès, la rectification, l’effacement ou l’export des données vous concernant, ainsi que la limitation ou l’opposition lorsque ces droits s’appliquent. Les demandes sur les données d’une entreprise sont coordonnées avec son responsable afin de préserver les droits des autres membres.</p>
          <p>Écrivez à l’adresse de contact indiquée en haut de cette page en précisant votre compte et le périmètre demandé. Ne transmettez ni mot de passe ni jeton. Vous pouvez également saisir l’autorité de protection des données compétente, notamment la <a className="text-primary underline" href="https://www.cnil.fr/fr/adresser-une-plainte">CNIL</a> en France.</p>
          <p>Cette politique est datée et mise à jour en cas d’évolution. Une modification des usages ou des autorisations Google sera présentée avant leur utilisation et fera l’objet d’un nouveau consentement lorsqu’il est nécessaire.</p>
        </PolicySection>
      </article>
    </PublicPage>
  );
}
