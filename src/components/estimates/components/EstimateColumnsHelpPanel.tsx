"use client";

import { useState } from "react";

import { COLUMN_HEADER_TOOLTIPS } from "@/components/estimates/components/ColumnHeaderHelp";
import { Modal } from "@/components/ui/Modal";

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
  { card: string; heading: string; badge: string }
> = {
  general: {
    card: "border-slate-200 bg-white",
    heading: "text-slate-700",
    badge: "bg-slate-100 text-slate-600",
  },
  supply: {
    card: "border-blue-200 bg-blue-50/60",
    heading: "text-blue-700",
    badge: "bg-blue-100 text-blue-700",
  },
  labor: {
    card: "border-amber-200 bg-amber-50/60",
    heading: "text-amber-700",
    badge: "bg-amber-100 text-amber-700",
  },
  sale: {
    card: "border-violet-200 bg-violet-50/60",
    heading: "text-violet-700",
    badge: "bg-violet-100 text-violet-700",
  },
  analysis: {
    card: "border-emerald-200 bg-emerald-50/60",
    heading: "text-emerald-700",
    badge: "bg-emerald-100 text-emerald-700",
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

export function EstimateColumnsHelpPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="inline-flex h-6 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold normal-case tracking-normal text-slate-600 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="estimate-columns-help-button"
        onClick={() => setOpen(true)}
      >
        Aide colonnes
      </button>

      <Modal.Root open={open} onOpenChange={setOpen}>
        <Modal.Content
          className="flex h-full max-h-[calc(100vh-2rem)] flex-col overflow-hidden rounded-[24px] p-0 sm:rounded-l-[24px] sm:rounded-r-none"
          containerClassName="ml-auto h-full sm:max-w-xl"
          data-testid="estimate-columns-help-panel"
        >
          <Modal.Header className="mb-0 shrink-0 border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-600">
                Guide du chiffrage
              </p>
              <Modal.Title className="mt-1 text-xl text-slate-950">
                Aide des colonnes
              </Modal.Title>
              <p className="mt-2 max-w-md text-sm leading-5 text-slate-600">
                Les explications sont regroupées ici pour garder les en-têtes
                lisibles et laisser les valeurs et alertes prioritaires.
              </p>
            </div>
            <Modal.Close aria-label="Fermer l’aide des colonnes">
              Fermer
            </Modal.Close>
          </Modal.Header>

          <Modal.Body className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50 px-5 py-5 sm:px-6">
            {HELP_SECTIONS.map((section) => {
              const tone = HELP_TONE_STYLES[section.tone];

              return (
                <section
                  className={`rounded-2xl border p-4 ${tone.card}`}
                  key={section.id}
                  aria-labelledby={`estimate-columns-help-${section.id}`}
                >
                  <h3
                    className={`text-xs font-bold uppercase tracking-[0.12em] ${tone.heading}`}
                    id={`estimate-columns-help-${section.id}`}
                  >
                    {section.title}
                  </h3>
                  <dl className="mt-3 divide-y divide-slate-200/80">
                    {section.items.map((item) => (
                      <div
                        className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[136px_minmax(0,1fr)] sm:gap-3"
                        key={item.label}
                      >
                        <dt className="flex flex-wrap items-start gap-1.5 font-semibold text-slate-900">
                          <span>{item.label}</span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tone.badge}`}
                          >
                            {item.kind}
                          </span>
                        </dt>
                        <dd className="text-sm leading-5 text-slate-600">
                          {item.description}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {section.note ? (
                    <p className="mt-3 border-t border-slate-200/80 pt-3 text-xs leading-5 text-slate-500">
                      {section.note}
                    </p>
                  ) : null}
                </section>
              );
            })}

            <section
              className="rounded-2xl border border-violet-200 bg-violet-950 p-4 text-white"
              aria-labelledby="estimate-columns-help-example"
            >
              <h3
                className="text-xs font-bold uppercase tracking-[0.12em] text-violet-200"
                id="estimate-columns-help-example"
              >
                Exemple de calcul du PU
              </h3>
              <p className="mt-3 font-mono text-sm leading-6 text-white">
                (100 € × 1,20 + 1 h × 1,10 × 50 €) × 1,10 = 192,50 €
              </p>
              <p className="mt-2 text-xs leading-5 text-violet-100">
                Ici : PR FO 100 €, K FO 1,20, une heure de MO à 50 €, K MO
                1,10 et coefficient de marge 1,10.
              </p>
            </section>
          </Modal.Body>
        </Modal.Content>
      </Modal.Root>
    </>
  );
}
