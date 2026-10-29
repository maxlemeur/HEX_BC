import Link from "next/link";

export function LegalLinks() {
  return (
    <nav aria-label="Informations légales" className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
      <Link className="underline-offset-4 hover:underline" href="/confidentialite">Confidentialité</Link>
      <Link className="underline-offset-4 hover:underline" href="/conditions">Conditions d’utilisation</Link>
      <Link className="underline-offset-4 hover:underline" href="/suppression-des-donnees">Suppression des données</Link>
    </nav>
  );
}
