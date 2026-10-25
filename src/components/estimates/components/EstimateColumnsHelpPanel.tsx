"use client";

import { useState } from "react";

import {
  COLUMN_HEADER_TOOLTIPS,
  ESTIMATE_V3_COLUMN_HEADER_TOOLTIPS,
} from "@/components/estimates/components/ColumnHeaderHelp";
import { useEstimateV3Grid } from "@/components/estimates/v3/V3LineCells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

type HelpTone = "general" | "supply" | "labor" | "sale" | "analysis";

type HelpItem = {
  label: string;
  description: string;
  kind: "Saisie" | "Calculé";
};

type HelpSection = {
  id: string;
  title: string;
  tone: HelpTone;
  items: HelpItem[];
  note?: string;
};

const HELP_TONE_STYLES: Record<
  HelpTone,
  {
    card: string;
    heading: string;
    badge: "neutral" | "info" | "warning" | "brand" | "success";
  }
> = {
  general: {
    card: "border-border bg-surface",
    heading: "text-foreground-secondary",
    badge: "neutral",
  },
  supply: {
    card: "border-info-border bg-info-subtle",
    heading: "text-info",
    badge: "info",
  },
  labor: {
    card: "border-warning-border bg-warning-subtle",
    heading: "text-warning",
    badge: "warning",
  },
  sale: {
    card: "border-primary/20 bg-primary/5",
    heading: "text-primary",
    badge: "brand",
  },
  analysis: {
    card: "border-success-border bg-success-subtle",
    heading: "text-success",
    badge: "success",
  },
};

const HELP_SECTIONS: HelpSection[] = [
  {
    id: "general",
    title: "Informations de ligne",
    tone: "general",
    items: [
      {
        label: "Désignation",
        description: COLUMN_HEADER_TOOLTIPS["Désignation"],
        kind: "Saisie",
      },
      {
        label: "Qté",
        description: COLUMN_HEADER_TOOLTIPS["Qté"],
        kind: "Saisie",
      },
      {
        label: "U",
        description: COLUMN_HEADER_TOOLTIPS["U"],
        kind: "Saisie",
      },
    ],
  },
  {
    id: "supply",
    title: "Fournitures",
    tone: "supply",
    items: [
      {
        label: "PR FO",
        description: COLUMN_HEADER_TOOLTIPS["PR FO"],
        kind: "Saisie",
      },
      {
        label: "Type FO",
        description: COLUMN_HEADER_TOOLTIPS["Type FO"],
        kind: "Saisie",
      },
      {
        label: "K FO",
        description: COLUMN_HEADER_TOOLTIPS["K FO"],
        kind: "Saisie",
      },
    ],
  },
  {
    id: "labor",
    title: "Main d’œuvre",
    tone: "labor",
    items: [
      {
        label: "h MO",
        description: COLUMN_HEADER_TOOLTIPS["h MO"],
        kind: "Saisie",
      },
      {
        label: "Type MO",
        description: COLUMN_HEADER_TOOLTIPS["Type MO"],
        kind: "Saisie",
      },
      {
        label: "K MO",
        description: COLUMN_HEADER_TOOLTIPS["K MO"],
        kind: "Saisie",
      },
      {
        label: "Majoration MO (%)",
        description: COLUMN_HEADER_TOOLTIPS["Majoration MO (%)"],
        kind: "Saisie",
      },
    ],
    note:
      "Lorsque la main d’œuvre est séparée, les mêmes principes s’appliquent aux colonnes atelier et chantier.",
  },
  {
    id: "sale",
    title: "Vente",
    tone: "sale",
    items: [
      {
        label: "PU",
        description: COLUMN_HEADER_TOOLTIPS["PU"],
        kind: "Calculé",
      },
      {
        label: "Prix total",
        description: COLUMN_HEADER_TOOLTIPS["Prix total"],
        kind: "Calculé",
      },
    ],
  },
  {
    id: "analysis",
    title: "Analyse de marge",
    tone: "analysis",
    items: [
      {
        label: "Déboursé sec",
        description: COLUMN_HEADER_TOOLTIPS["Deboursé sec"],
        kind: "Calculé",
      },
      {
        label: "Marge €",
        description: COLUMN_HEADER_TOOLTIPS["Marge €"],
        kind: "Calculé",
      },
      {
        label: "Marque %",
        description: COLUMN_HEADER_TOOLTIPS["Marque %"],
        kind: "Calculé",
      },
    ],
  },
];

const V3_TIP = ESTIMATE_V3_COLUMN_HEADER_TOOLTIPS;

/** Moteur de calcul 3 (sous-lot 2.6, D4, D11) : heures par unité, formule complète du PU. */
const HELP_SECTIONS_V3: HelpSection[] = [
  {
    id: "general",
    title: "Informations de ligne",
    tone: "general",
    items: [
      { label: "Désignation", description: V3_TIP["Désignation"], kind: "Saisie" },
      { label: "Qté", description: V3_TIP["Qté"], kind: "Saisie" },
      { label: "U", description: V3_TIP["U"], kind: "Saisie" },
      { label: "Statut", description: V3_TIP["Statut"], kind: "Saisie" },
      { label: "TVA %", description: V3_TIP["TVA %"], kind: "Saisie" },
    ],
  },
  {
    id: "supply",
    title: "Fournitures",
    tone: "supply",
    items: [
      { label: "PR FO", description: V3_TIP["PR FO"], kind: "Saisie" },
      { label: "Type FO", description: COLUMN_HEADER_TOOLTIPS["Type FO"], kind: "Saisie" },
      { label: "Provision FO", description: V3_TIP["Provision FO"], kind: "Calculé" },
      { label: "K FO", description: V3_TIP["K FO"], kind: "Saisie" },
    ],
  },
  {
    id: "labor",
    title: "Main d’œuvre",
    tone: "labor",
    items: [
      { label: "h MO / u", description: V3_TIP["h MO / u"], kind: "Saisie" },
      { label: "h MO total", description: "Qté × h MO / u, arrondi à 3 décimales : jamais saisi.", kind: "Calculé" },
      { label: "Type MO", description: V3_TIP["Type MO"], kind: "Saisie" },
      { label: "K MO", description: V3_TIP["K MO"], kind: "Saisie" },
      { label: "Majoration MO (%)", description: V3_TIP["Majoration MO (%)"], kind: "Saisie" },
    ],
    note:
      "Lorsque la main d’œuvre est séparée, l’atelier et le chantier se saisissent aussi en heures par unité.",
  },
  {
    id: "sale",
    title: "Vente",
    tone: "sale",
    items: [
      { label: "PU", description: V3_TIP["PU"], kind: "Calculé" },
      { label: "Prix total", description: V3_TIP["Prix total"], kind: "Calculé" },
    ],
  },
  {
    id: "analysis",
    title: "Analyse de marge",
    tone: "analysis",
    items: [
      { label: "Déboursé sec", description: V3_TIP["Deboursé sec"], kind: "Calculé" },
      { label: "Marge €", description: V3_TIP["Marge €"], kind: "Calculé" },
      { label: "Marque %", description: V3_TIP["Marque %"], kind: "Calculé" },
    ],
  },
];

export function EstimateColumnsHelpPanel() {
  const [open, setOpen] = useState(false);
  // Lot 2, sous-lot 2.6 : l'aide suit le moteur de la version ouverte (v1/v2 : heures de ligne).
  const isV3 = useEstimateV3Grid() !== null;
  const sections = isV3 ? HELP_SECTIONS_V3 : HELP_SECTIONS;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="h-6 px-2 text-micro normal-case tracking-normal"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="estimate-columns-help-button"
        onClick={() => setOpen(true)}
      >
        Aide colonnes
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className="gap-0 bg-surface p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
          data-testid="estimate-columns-help-panel"
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-5 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                Guide du chiffrage
              </p>
              <SheetTitle className="mt-1 text-lg font-semibold text-foreground">
                Aide des colonnes
              </SheetTitle>
              <SheetDescription className="mt-2 max-w-md leading-5 text-muted-foreground">
                Les explications sont regroupées ici pour garder les en-têtes
                lisibles et laisser les valeurs et alertes prioritaires.
              </SheetDescription>
            </div>
            <SheetClose
              render={<Button type="button" variant="outline" size="md" className="shrink-0" />}
              aria-label="Fermer l’aide des colonnes"
            >
              Fermer
            </SheetClose>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-surface-subtle px-5 py-5 sm:px-6">
            {sections.map((section) => {
              const tone = HELP_TONE_STYLES[section.tone];

              return (
                <section
                  className={`rounded-lg border p-4 ${tone.card}`}
                  key={section.id}
                  aria-labelledby={`estimate-columns-help-${section.id}`}
                >
                  <h3
                    className={`text-xs font-bold uppercase tracking-[0.12em] ${tone.heading}`}
                    id={`estimate-columns-help-${section.id}`}
                  >
                    {section.title}
                  </h3>
                  <dl className="mt-3 divide-y divide-border">
                    {section.items.map((item) => (
                      <div
                        className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[136px_minmax(0,1fr)] sm:gap-3"
                        key={item.label}
                      >
                        <dt className="flex flex-wrap items-start gap-1.5 font-semibold text-foreground">
                          <span>{item.label}</span>
                          <Badge
                            variant={tone.badge}
                            size="sm"
                            className="uppercase tracking-wide"
                          >
                            {item.kind}
                          </Badge>
                        </dt>
                        <dd className="text-sm leading-5 text-foreground-secondary">
                          {item.description}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {section.note ? (
                    <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                      {section.note}
                    </p>
                  ) : null}
                </section>
              );
            })}

            <section
              className="rounded-lg border border-primary bg-primary p-4 text-primary-foreground"
              aria-labelledby="estimate-columns-help-example"
            >
              <h3
                className="text-xs font-bold uppercase tracking-[0.12em] text-primary-foreground"
                id="estimate-columns-help-example"
              >
                Exemple de calcul du PU
              </h3>
              {isV3 ? (
                <>
                  <p className="mt-3 font-mono text-sm leading-6 text-primary-foreground">
                    100 € × 1,03 × 1,20 × 1,30 + 1 h × 100 % × 1,10 × 50 € × 1,20 = 226,68 €
                  </p>
                  <p className="mt-2 text-xs leading-5 text-primary-foreground">
                    Ici : un tube à PR FO 100 €, provision FO 1,03, K FO 1,20, coefficient de vente
                    FO 1,30, 1 h MO / u à 50 €/h, majoration 100 %, K MO 1,10 et coefficient de
                    vente MO 1,20 : le PU est arrondi au centime une seule fois.
                  </p>
                  <p className="mt-2 text-xs leading-5 text-primary-foreground">
                    Les heures étant par unité, une Qté de 2 double la fourniture et la main
                    d’œuvre : h MO total = 2 h et prix total = 2 × 226,68 € = 453,36 €.
                  </p>
                </>
              ) : (
              <>
              <p className="mt-3 font-mono text-sm leading-6 text-primary-foreground">
                (1 × 100 € × 1,20 + 1 h × 1,10 × 50 €) × 1,10 = 192,50 €
              </p>
              <p className="mt-2 text-xs leading-5 text-primary-foreground">
                Ici : Qté 1, PR FO 100 €, K FO 1,20, une heure de MO pour la
                ligne à 50 €, majoration 100 %, K MO 1,10 et coefficient de
                marge 1,10.
              </p>
              <p className="mt-2 text-xs leading-5 text-primary-foreground">
                h MO étant les heures totales de la ligne, une Qté de 2 double
                la fourniture mais pas l’heure : (2 × 100 € × 1,20 + 1 h × 1,10
                × 50 €) × 1,10 = 324,50 €, soit un PU de 162,25 €.
              </p>
              </>
              )}
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
