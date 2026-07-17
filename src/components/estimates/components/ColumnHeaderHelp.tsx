"use client";

import { Popover } from "@/components/ui/Popover";

export const COLUMN_HEADER_TOOLTIPS: Record<string, string> = {
  "Désignation": "Désignation de l'article ou de la prestation",
  "Qté": "Quantité d'unités",
  "U": "Unité de mesure (m, m², ml, u, etc.)",
  "PR. FO": "Prix unitaire fourniture HT (prix catalogue fournisseur)",
  "K FO": "Coefficient fourniture — multiplie uniquement le prix de revient FO et ne modifie jamais la MO. Ex : K = 1.20 → +20% sur le prix FO",
  "h MO": "Heures de main d'œuvre par unité",
  "Majoration MO (%)": "Pourcentage de majoration appliqué au coût MO (indépendant du coefficient K MO). Ex : 10% → le coût MO est multiplié par 1.10",
  "K MO": "Coefficient main d'œuvre — multiplie le taux horaire. Ex : K = 1.30 → marge de +30% sur le taux horaire MO",
  "P.U.": "P.U. = (PR. FO × K FO + h MO × K MO × prix horaire MO) × coefficient de marge. Si le taux horaire du rôle vaut 0 €/h, la MO contribue 0 € au P.U.",
  "Prix total": "Prix total HT = P.U. × Qté",
  "Type FO": "Type / catégorie de fourniture",
  "Type MO": "Rôle / type de main d'œuvre et taux horaire utilisé dans le calcul",
  "h MO atelier": "Heures de main d'œuvre atelier par unité",
  "Type MO atelier": "Rôle / type de main d'œuvre atelier",
  "K MO atelier": "Coefficient main d'œuvre atelier",
  "h MO chantier": "Heures de main d'œuvre chantier par unité",
  "Type MO chantier": "Rôle / type de main d'œuvre chantier",
  "K MO chantier": "Coefficient main d'œuvre chantier",
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
      className={`inline-flex items-center gap-1 ${
        allowWrap ? "whitespace-normal" : "whitespace-nowrap"
      }`}
    >
      {label}
      <Popover
        hover
        trigger={
          <button
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-blue-300 text-[10px] leading-none text-blue-400 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
            type="button"
            aria-label={`Aide : ${label}`}
          >
            ?
          </button>
        }
      >
        {tooltip}
      </Popover>
    </span>
  );
}
