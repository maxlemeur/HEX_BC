"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Moteurs de calcul 1 et 2 (seuls en service, sous-lot 2.3, C-01, D11) : « h MO » porte les heures
// totales de la ligne ; la quantité multiplie la fourniture, pas les heures.
export const COLUMN_HEADER_TOOLTIPS: Record<string, string> = {
  "Désignation": "Désignation de l'article ou de la prestation",
  "Qté": "Quantité d'unités. Elle multiplie la fourniture, pas les heures MO, qui sont les heures totales de la ligne.",
  "U": "Unité de mesure (m, m², ml, u, etc.)",
  "PR FO": "Prix unitaire fourniture HT (prix catalogue fournisseur)",
  "K FO": "Coefficient fourniture — multiplie uniquement le prix de revient FO et ne modifie jamais la MO. Ex : K = 1.20 → +20% sur le prix FO",
  "h MO": "Heures de main d'œuvre : heures totales de la ligne, et non par unité. Changer la quantité ne change pas ces heures. L'import d'un classeur OPTIMA convertit ses heures par unité en h/u × Q.",
  "Majoration MO (%)": "Majoration appliquée au coût MO, en plus du K MO : 100 % = neutre, 115 % = +15 %. Stockée en coefficient (115 % → ×1,15), entre 0 % et 1 000 %.",
  "K MO": "Coefficient de rendement main d'œuvre, propre à l'ouvrage — majore le coût MO selon la difficulté d'exécution. Ex : travail en hauteur → K = 1.30, soit +30% de temps MO",
  "PU": "PU = Prix total ÷ Qté. Les heures MO comptent une fois pour toute la ligne, quelle que soit la quantité. Si le taux horaire du rôle vaut 0 €/h, la MO contribue 0 €.",
  "Prix total": "Prix total HT de la ligne = (Qté × PR FO × K FO + h MO × Majoration MO × K MO × taux horaire) × coefficient de marge, avec h MO les heures totales de la ligne.",
  "Type FO": "Type / catégorie de fourniture",
  "Type MO": "Rôle / type de main d'œuvre et taux horaire utilisé dans le calcul",
  "h MO atelier": "Heures de main d'œuvre atelier : heures totales de la ligne, et non par unité",
  "Type MO atelier": "Rôle / type de main d'œuvre atelier",
  "K MO atelier": "Coefficient de rendement main d'œuvre atelier (difficulté d'exécution)",
  "h MO chantier": "Heures de main d'œuvre chantier : heures totales de la ligne, et non par unité",
  "Type MO chantier": "Rôle / type de main d'œuvre chantier",
  "K MO chantier": "Coefficient de rendement main d'œuvre chantier (difficulté d'exécution)",
  "Deboursé sec":
    "Coût direct de la ligne : Qté × PR FO × K FO + h MO × Majoration MO × K MO × taux horaire, avec h MO les heures totales de la ligne. C'est ce que la ligne vous coûte, avant toute marge.",
  "Marge €":
    "Prix total HT − déboursé sec. Marge BRUTE : la remise et le coefficient global sont des grandeurs de version, appliquées au pied du devis.",
  "Marque %":
    "Taux de marque = marge / prix de vente. À ne pas confondre avec le taux de marge (marge / déboursé) : sur un coefficient de vente 1,35, la marque vaut 25,9 % et la marge 35 %.",
};

/**
 * Moteur de calcul 3 (sous-lot 2.6, D4, D7, D11, §4 de la conception) : « h MO / u » porte les heures
 * **par unité**, la quantité les multiplie ; PU arrondi au centime une seule fois, PT = Qté × PU.
 */
export const ESTIMATE_V3_COLUMN_HEADER_TOOLTIPS: Record<string, string> = {
  "Désignation": "Désignation de l'article ou de la prestation, avec son statut de chiffrage et son taux de TVA.",
  "Qté": "Quantité d'unités. Elle multiplie la fourniture et les heures de main d'œuvre (h MO / u).",
  "U": "Unité du référentiel (ml — mètre linéaire, m2 — mètre carré, u — unité…). Un alias saisi (« ML », « m² ») est validé à la sortie du champ.",
  "Statut": "Statut de chiffrage : seule une ligne « Chiffrée » entre au HT et à la TVA. Une ligne « Hors lot », « Inclus », « Pour mémoire », « Non chiffrée » ou « Sans objet » garde ses saisies, à 0 €.",
  "TVA %": "Taux de TVA de la ligne. La TVA se calcule par taux sur la somme des nets de ligne, puis se répartit entre les lignes du taux.",
  "PR FO": "Prix d'achat unitaire fourniture HT (prix catalogue fournisseur)",
  "Provision FO": "Provision pour pertes, chutes et petites fournitures, fixée par le type FO : 1,03 pour un tube ou un calorifuge, 1,01 sinon. Elle multiplie le PR FO avant le K FO et se redérive quand le type FO change ; une ligne antérieure garde 1,00.",
  "K FO": "Coefficient de coût fourniture — multiplie uniquement le prix de revient FO, après la provision FO. Ex : K = 1.20 → +20% sur le prix FO",
  "h MO / u": "Heures de main d'œuvre par unité. Le total d'heures de la ligne (h MO total, en lecture seule) vaut Qté × h MO / u.",
  "Majoration MO (%)": "Majoration appliquée au coût MO, en plus du K MO : 100 % = neutre, 115 % = +15 %. Stockée en coefficient (115 % → ×1,15), entre 0 % et 1 000 %.",
  "K MO": "Coefficient de coût main d'œuvre (difficulté d'exécution). Ex : travail en hauteur → K = 1.30",
  "Type MO": "Rôle de main d'œuvre et son taux horaire, celui du propriétaire du devis.",
  "PU": "PU = arrondi au centime de (PR FO × provision FO × K FO × coefficient de vente FO + h MO / u × Majoration MO × K MO × taux horaire × coefficient de vente MO), un seul arrondi.",
  "Prix total": "Prix total HT brut de la ligne = arrondi au centime de Qté × PU. La remise et l'arrondi commercial se répartissent ensuite entre les lignes pour donner le HT net.",
  "Deboursé sec": "Coût direct de la ligne : Qté × (PR FO × provision FO × K FO + h MO / u × Majoration MO × K MO × taux horaire), avant les coefficients de vente.",
  "Marge €": "Prix total HT brut − déboursé sec, avant la remise et l'arrondi commercial du pied.",
  "Marque %": "Taux de marque = marge / prix de vente.",
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
