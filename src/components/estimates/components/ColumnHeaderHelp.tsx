"use client";

import { Popover } from "@/components/ui/Popover";

export const COLUMN_HEADER_TOOLTIPS: Record<string, string> = {
  "Désignation": "Désignation de l'article ou de la prestation",
  "Qté": "Quantité d'unités",
  "U": "Unité de mesure (m, m², ml, u, etc.)",
  "PR. FO": "Prix unitaire fourniture HT",
  "K FO": "Coefficient fourniture — multiplie le prix unitaire",
  "h MO": "Heures de main d'œuvre par unité",
  "Majoration MO (%)": "Pourcentage de majoration main d'œuvre",
  "K MO": "Coefficient main d'œuvre — multiplie le taux horaire",
  "P.U.": "Prix unitaire de vente HT (fourniture + main d'œuvre)",
  "Prix total": "Prix total HT de la ligne",
  "Type FO": "Type / catégorie de fourniture",
  "Type MO": "Rôle / type de main d'œuvre",
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
        trigger={
          <button
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-[var(--slate-300)] text-[10px] leading-none text-[var(--slate-500)] hover:bg-[var(--slate-100)]"
            type="button"
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
