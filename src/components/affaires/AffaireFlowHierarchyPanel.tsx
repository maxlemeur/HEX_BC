"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/Badge";
import type { VersionZeroDraftSummary } from "@/lib/estimates/client";
import type { AffaireHubSummaryResult } from "@/lib/affaires/server";

import type { AffaireHubPlansSummaryData } from "./PlansMetresCard";

type AffaireFlowHierarchyPanelProps = {
  projectId: string;
  currentVersion: AffaireHubSummaryResult["currentVersion"] | null;
  versionZeroSummary?: VersionZeroDraftSummary | null;
  takeoffEnabled?: boolean;
  plansSummary?: AffaireHubPlansSummaryData | null;
};

type FlowCard = {
  key: "principal" | "adjacent" | "legacy";
  label: string;
  summary: string;
  badgeLabel: string;
  badgeVariant: "success" | "info" | "warning";
  highlights: string[];
  links: Array<{
    href: string;
    label: string;
    variant: "secondary" | "ghost";
  }>;
  footnote: string;
};

function buildCards(
  input: Readonly<AffaireFlowHierarchyPanelProps>
): FlowCard[] {
  const principalCard: FlowCard = {
    key: "principal",
    label: "Flux principal",
    summary:
      "L'affaire reste la voie par defaut pour avancer, corriger les exceptions et finir le dossier sans dispersion.",
    badgeLabel: "Ici",
    badgeVariant: "success",
    highlights: [
      "Dossier, brief, DPGF, devis, validation et sortie restent alignes ici.",
      "Les prochaines actions prioritaires restent visibles dans le pilotage.",
    ],
    links: [],
    footnote: "Restez d'abord dans l'affaire, puis ouvrez une aide seulement si elle sert le dossier.",
  };

  const adjacentLinks: FlowCard["links"] = [];
  if (input.takeoffEnabled) {
    adjacentLinks.push({
      href: `/dashboard/affaires/${input.projectId}/plans`,
      label: "Ouvrir les plans",
      variant: "secondary",
    });
    adjacentLinks.push({
      href: `/dashboard/affaires/${input.projectId}/takeoff`,
      label: "Ouvrir le centre metres",
      variant: "ghost",
    });
  }
  if (
    input.currentVersion?.status === "draft" &&
    (input.versionZeroSummary?.activeDraft || input.versionZeroSummary?.canGenerate)
  ) {
    adjacentLinks.push({
      href: `/dashboard/estimates/${input.currentVersion.id}/edit?openVersionZero=1`,
      label: input.versionZeroSummary?.activeDraft ? "Revoir V0 IA" : "Ouvrir V0 IA",
      variant: "ghost",
    });
  }

  const adjacentHighlights = [
    "Plans, centre metres et aides IA servent a accelerer ou completer le flux principal.",
  ];
  if ((input.plansSummary?.planSetCount ?? 0) > 0) {
    adjacentHighlights.push(
      `${input.plansSummary?.planSetCount ?? 0} jeu${(input.plansSummary?.planSetCount ?? 0) > 1 ? "x" : ""} de plans reste${(input.plansSummary?.planSetCount ?? 0) > 1 ? "nt" : ""} pilotable${(input.plansSummary?.planSetCount ?? 0) > 1 ? "s" : ""} sans sortir du parcours affaire-first.`
    );
  }

  const adjacentCard: FlowCard = {
    key: "adjacent",
    label: "Aides adjacentes",
    summary:
      "Ces surfaces restent secondaires: elles aident a preparer ou reprendre le dossier, sans remplacer le parcours affaire.",
    badgeLabel: "Secondaire",
    badgeVariant: "info",
    highlights: adjacentHighlights,
    links: adjacentLinks,
    footnote:
      "Ouvrez une aide adjacente seulement quand elle repond a un besoin precise de plans, metres ou structuration.",
  };

  const hasLegacyEntry = input.takeoffEnabled && input.currentVersion !== null;
  const legacyCard: FlowCard = {
    key: "legacy",
    label: "Fallback legacy",
    summary:
      "Le takeoff estimate-first reste un recours volontaire, utile seulement pour reprendre un contexte existant ou un cas de fallback.",
    badgeLabel: "Volontaire",
    badgeVariant: "warning",
    highlights: hasLegacyEntry
      ? [
          "Le flux principal reste l'affaire; le legacy n'est jamais propose comme voie normale.",
          `Le fallback pointe vers la V${input.currentVersion?.versionNumber ?? "?"} actuelle pour garder une reprise tracee.`,
        ]
      : [
          "Aucun fallback utile n'est propose tant qu'une version active ou le metre affaire-first n'est pas disponible.",
        ],
    links: hasLegacyEntry
      ? [
          {
            href: `/dashboard/estimates/${input.currentVersion?.id}/takeoff`,
            label: "Ouvrir le fallback legacy",
            variant: "secondary",
          },
        ]
      : [],
    footnote:
      "Si vous ouvrez ce fallback, TIMAX doit vous rappeler comment revenir au flux principal.",
  };

  return [principalCard, adjacentCard, legacyCard];
}

export function AffaireFlowHierarchyPanel(
  props: Readonly<AffaireFlowHierarchyPanelProps>
) {
  const cards = buildCards(props);

  return (
    <section className="rounded-2xl border border-[var(--slate-200)] bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(255,255,255,0.96))] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-500)]">
            Parcours recommande
          </p>
          <h2 className="mt-2 text-sm font-semibold text-[var(--slate-800)] text-balance">
            Principal, adjacent et legacy restent visibles des l&apos;affaire
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--slate-600)]">
            Le cockpit garde la narration principale. Les aides restent explicites, et le
            fallback legacy ne s&apos;ouvre que volontairement.
          </p>
        </div>
        <Badge variant="neutral" size="sm">
          Aucun renvoi par defaut vers le legacy
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {cards.map((card) => (
          <article
            key={card.key}
            className={`rounded-2xl border p-4 ${
              card.key === "principal"
                ? "border-[var(--success)]/25 bg-[var(--success)]/5"
                : card.key === "legacy"
                  ? "border-[var(--warning)]/25 bg-[var(--warning)]/6"
                  : "border-[var(--brand-blue)]/18 bg-[var(--brand-blue)]/5"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--slate-800)]">{card.label}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--slate-600)]">{card.summary}</p>
              </div>
              <Badge variant={card.badgeVariant} size="sm" withDot>
                {card.badgeLabel}
              </Badge>
            </div>

            <ul className="mt-4 space-y-2">
              {card.highlights.map((highlight) => (
                <li
                  key={highlight}
                  className="rounded-xl border border-white/80 bg-white/80 px-3 py-2 text-sm text-[var(--slate-600)]"
                >
                  {highlight}
                </li>
              ))}
            </ul>

            {card.links.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-3">
                {card.links.map((link) => (
                  <Link
                    key={`${card.key}-${link.href}-${link.label}`}
                    href={link.href}
                    className={
                      link.variant === "secondary"
                        ? "btn btn-secondary btn-sm"
                        : "btn btn-ghost btn-sm"
                    }
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ) : null}

            <p className="mt-4 text-xs font-medium leading-5 text-[var(--slate-500)]">
              {card.footnote}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
