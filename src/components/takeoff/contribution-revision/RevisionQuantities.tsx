import type { RevisionItem } from "@/lib/takeoff/contribution-revision-contracts";

export const sourceNames = {
  measured: "mesure",
  entered: "saisie du plan",
  verified_count: "comptage vérifié",
  withdraw: "retrait",
};
export function quantity(value: number | null, unit?: string | null) {
  return value === null
    ? "à décider"
    : [value.toLocaleString("fr-FR", { maximumFractionDigits: 12 }), unit].filter(Boolean).join(" ");
}

export function RevisionQuantities({ item, version }: { item: RevisionItem; version: number }) {
  const pending = item.correction;
  const proof = item.sent.find(
    (part) => part.marks_revision !== null && part.marks_revision !== item.sources.marks_revision,
  );
  const entry = item.sent.find(
    (part) => part.entry_revision !== null && part.entry_revision !== item.sources.plan_entry_revision,
  );
  return (
    <div className="my-1 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label={`Apport du devis V${version}`}>
      <div>
        <strong>Déjà envoyé · V{version}</strong>
        {item.sent.length ? (
          item.sent.map((part) => (
            <div key={part.id}>
              {quantity(part.quantity, part.unit)} · {sourceNames[part.kind]}
              {part.pages.length ? ` · p. ${part.pages.join(", ")}` : ""}
              {part.line_title ? ` · ${part.line_title}` : ""}
            </div>
          ))
        ) : (
          <div>Aucun apport de ce poste dans cet envoi.</div>
        )}
      </div>
      {pending && (
        <div>
          <strong>Correction à confirmer</strong>
          <div>
            {quantity(pending.quantity, pending.source === "withdraw" ? null : item.sources.unit)}
            {pending.source && ` · ${sourceNames[pending.source]}`}
          </div>
          {proof && (
            <div>
              Repères corrigés · révision {proof.marks_revision} → {item.sources.marks_revision}
            </div>
          )}
          {entry && (
            <div>
              Saisie du plan · révision {entry.entry_revision} → {item.sources.plan_entry_revision ?? "retirée"}
            </div>
          )}
          {!pending.ready && <div>Quantité à vérifier avant confirmation.</div>}
        </div>
      )}
    </div>
  );
}
