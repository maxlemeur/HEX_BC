import type { TakeoffFlowKind } from "@/lib/takeoff/flow-hierarchy";

type TakeoffFlowHierarchyPanelProps = {
  currentKind: Exclude<TakeoffFlowKind, "legacy">;
  legacyPlanSetCount: number;
};

const FLOW_CARDS: Array<{
  kind: TakeoffFlowKind;
  label: string;
  summary: string;
}> = [
  {
    kind: "principal",
    label: "Parcours recommandé",
    summary:
      "Ajoutez les plans, lancez l’analyse, contrôlez les quantités, puis intégrez-les au devis.",
  },
  {
    kind: "adjacent",
    label: "Suivi et reprise",
    summary:
      "Suivez les analyses, les exceptions et les reprises depuis ce centre.",
  },
  {
    kind: "legacy",
    label: "Anciens jeux de plans",
    summary:
      "Rouvrez les jeux rattachés à d’anciennes versions du devis.",
  },
];

function getCardClassName(input: {
  kind: TakeoffFlowKind;
  currentKind: Exclude<TakeoffFlowKind, "legacy">;
}) {
  if (input.kind === input.currentKind) {
    return "border-[var(--brand-blue)]/30 bg-[var(--brand-blue)]/5";
  }

  if (input.kind === "legacy") {
    return "border-[var(--warning)]/20 bg-[var(--warning)]/5";
  }

  return "border-[var(--slate-200)] bg-white";
}

export function TakeoffFlowHierarchyPanel({
  currentKind,
  legacyPlanSetCount,
}: TakeoffFlowHierarchyPanelProps) {
  return (
    <aside aria-label="Aide sur l’organisation des métrés" className="mb-4 max-w-full">
      <details className="group max-w-full overflow-hidden rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70">
        <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left outline-none transition-colors hover:bg-white/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--brand-blue)] [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block break-words text-sm font-semibold leading-5 text-[var(--slate-800)]">
              Comment s’organise un métré ?
            </span>
            {legacyPlanSetCount > 0 ? (
              <span className="mt-1 block break-words text-xs leading-5 text-[var(--slate-500)]">
                {legacyPlanSetCount} ancien{legacyPlanSetCount > 1 ? "s" : ""} jeu
                {legacyPlanSetCount > 1 ? "x" : ""} de plans disponible
                {legacyPlanSetCount > 1 ? "s" : ""}
              </span>
            ) : null}
          </span>
          <svg
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-[var(--slate-500)] transition-transform duration-200 group-open:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="m6 9 6 6 6-6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </summary>

        <div className="grid max-w-full gap-2 border-t border-[var(--slate-200)] p-2 sm:gap-3 sm:p-3 lg:grid-cols-3">
          {FLOW_CARDS.map((card) => (
            <section
              key={card.kind}
              className={`min-w-0 rounded-xl border px-3 py-2.5 sm:py-3 ${getCardClassName({
                kind: card.kind,
                currentKind,
              })}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="break-words text-sm font-semibold text-[var(--slate-800)]">
                  {card.label}
                </h3>
                {card.kind === currentKind ? (
                  <span className="rounded-full bg-[var(--brand-blue)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--brand-blue)]">
                    Page actuelle
                  </span>
                ) : null}
                {card.kind === "legacy" ? (
                  <span className="rounded-full bg-[var(--warning)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--warning)]">
                    Dossiers existants
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 break-words text-sm leading-5 text-[var(--slate-600)] sm:mt-2 sm:leading-6">
                {card.summary}
              </p>
            </section>
          ))}
        </div>
      </details>
    </aside>
  );
}
