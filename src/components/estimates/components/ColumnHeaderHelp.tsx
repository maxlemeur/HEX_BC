"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const COLUMN_HEADER_TOOLTIPS: Record<string, string> = {
  "Désignation": "Désignation de l'article ou de la prestation",
  "Qté": "Quantité d'unités",
  "U": "Unité de mesure (m, m², ml, u, etc.)",
  "PR FO": "Prix unitaire fourniture HT (prix catalogue fournisseur)",
  "K FO": "Coefficient fourniture — multiplie uniquement le prix de revient FO et ne modifie jamais la MO. Ex : K = 1.20 → +20% sur le prix FO",
  "h MO": "Heures de main d'œuvre par unité",
  "Majoration MO (%)": "Majoration globale appliquée au coût MO en plus du K MO. Non utilisée pour le moment : laisser à 100% (neutre). Conservée pour la compatibilité des imports/exports OPTIMA.",
  "K MO": "Coefficient de rendement main d'œuvre, propre à l'ouvrage — majore le coût MO selon la difficulté d'exécution. Ex : travail en hauteur → K = 1.30, soit +30% de temps MO",
  "PU": "PU = (PR FO × K FO + h MO × K MO × prix horaire MO) × coefficient de marge. Si le taux horaire du rôle vaut 0 €/h, la MO contribue 0 € au PU.",
  "Prix total": "Prix total HT = PU × Qté",
  "Type FO": "Type / catégorie de fourniture",
  "Type MO": "Rôle / type de main d'œuvre et taux horaire utilisé dans le calcul",
  "h MO atelier": "Heures de main d'œuvre atelier par unité",
  "Type MO atelier": "Rôle / type de main d'œuvre atelier",
  "K MO atelier": "Coefficient de rendement main d'œuvre atelier (difficulté d'exécution)",
  "h MO chantier": "Heures de main d'œuvre chantier par unité",
  "Type MO chantier": "Rôle / type de main d'œuvre chantier",
  "K MO chantier": "Coefficient de rendement main d'œuvre chantier (difficulté d'exécution)",
  "Deboursé sec":
    "Coût direct de la ligne : fourniture × K FO + heures MO × K MO × taux horaire. C'est ce que la ligne vous coûte, avant toute marge.",
  "Marge €":
    "Prix total HT − déboursé sec. Marge BRUTE : la remise et le coefficient global sont des grandeurs de version, appliquées au pied du devis.",
  "Marque %":
    "Taux de marque = marge / prix de vente. À ne pas confondre avec le taux de marge (marge / déboursé) : sur un coefficient de vente 1,35, la marque vaut 25,9 % et la marge 35 %.",
};

type ColumnHeaderHelpProps = {
  label: string;
  tooltip: string;
  allowWrap?: boolean;
};

export function ColumnHeaderHelp({
  label,
  tooltip,
  allowWrap = false,
}: ColumnHeaderHelpProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-micro ${
        allowWrap ? "whitespace-normal" : "whitespace-nowrap"
      }`}
    >
      {label}
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={200}
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-info-border bg-info-subtle p-0 text-micro font-bold leading-none text-info outline-none hover:bg-info-light focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          aria-label={`Aide : ${label}`}
        >
          ?
        </PopoverTrigger>
        <PopoverContent className="w-auto max-w-xs text-xs leading-relaxed text-foreground-secondary">
          {tooltip}
        </PopoverContent>
      </Popover>
    </span>
  );
}
