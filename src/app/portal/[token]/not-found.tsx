import { LinkIcon } from "lucide-react";

/**
 * Lien inconnu ou révoqué : l'organisation émettrice n'est pas identifiable,
 * donc aucune coordonnée n'est affichée (UX67). Le message dit quoi vérifier
 * et à qui s'adresser.
 */
export default function PortalNotFound() {
  return (
    <div className="flex min-h-[400px] flex-col items-center justify-center text-center">
      <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-muted">
        <LinkIcon aria-hidden="true" className="size-7 text-muted-foreground" />
      </div>
      <h1 className="typo-h1 text-foreground">Lien de consultation invalide</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        Ce lien est incomplet, a été désactivé ou n’existe pas.
      </p>
      <ul className="mt-4 max-w-md list-disc space-y-2 pl-5 text-left text-sm text-foreground-secondary">
        <li>
          Vérifiez que l’adresse a été copiée en entier depuis l’e-mail reçu, ou
          cliquez directement sur le bouton de l’e-mail.
        </li>
        <li>
          Si le problème persiste, demandez un nouveau lien à l’entreprise qui
          vous a envoyé le devis.
        </li>
      </ul>
    </div>
  );
}
