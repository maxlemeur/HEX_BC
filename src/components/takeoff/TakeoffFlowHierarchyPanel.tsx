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
    label: "Flux principal",
    summary:
      "Affaire -> plans -> analyse -> revue/apply. C'est la voie par defaut pour avancer dans TIMAX.",
  },
  {
    kind: "adjacent",
    label: "Aides adjacentes",
    summary:
      "Centre d'activite, exceptions et historique servent a piloter ou reprendre le flux principal sans ouvrir une filiere parallele.",
  },
  {
    kind: "legacy",
    label: "Fallback legacy",
    summary:
      "Les jeux lies a une version restent disponibles uniquement comme recours volontaire et balise.",
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
    <section className="mb-6 rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--slate-400)]">
            Hierarchie des flux
          </p>
          <h2 className="mt-1 text-sm font-semibold text-[var(--slate-800)]">
            Principal, adjacent et legacy restent distingues
          </h2>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs text-[var(--slate-500)] ring-1 ring-[var(--slate-200)]">
          {legacyPlanSetCount} fallback{legacyPlanSetCount > 1 ? "s" : ""} legacy actif
          {legacyPlanSetCount > 1 ? "s" : ""}
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {FLOW_CARDS.map((card) => (
          <div
            key={card.kind}
            className={`rounded-xl border px-4 py-4 ${getCardClassName({
              kind: card.kind,
              currentKind,
            })}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-[var(--slate-800)]">
                {card.label}
              </span>
              {card.kind === currentKind ? (
                <span className="rounded-full bg-[var(--brand-blue)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--brand-blue)]">
                  ici
                </span>
              ) : null}
              {card.kind === "legacy" ? (
                <span className="rounded-full bg-[var(--warning)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--warning)]">
                  volontaire
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--slate-600)]">
              {card.summary}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
