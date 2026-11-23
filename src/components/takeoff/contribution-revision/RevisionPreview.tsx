"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { canKeepBoth } from "@/lib/takeoff/contribution-revision-choices";
import type { RevisionChoices, RevisionPreview as Preview } from "@/lib/takeoff/contribution-revision-contracts";
import { ItemSendPoint } from "../item-send/ItemSendChoices";
import { ItemSendBreakdownChoice, ItemSendBlocked, ItemSendLines } from "../item-send/ItemSendPreviewSections";
import { quantity, sourceNames } from "./RevisionQuantities";

const protections: Record<string, string> = {
  edited: "modifiée ou chiffrée",
  quantity: "avec une quantité saisie",
  section: "dans une section personnalisée",
  used: "utilisée ailleurs",
  dpgf: "issue du DPGF",
  copy_history: "dont l’historique est incomplet",
  deleted: "supprimée",
};
function explanation(b: Preview["blockers"][number], change?: Preview["changes"][number]) {
  if (b.message) return b.message;
  switch (b.reason) {
    case "review_required":
      return "Vérifiez les repères ou choisissez une source de quantité dans le détail du poste.";
    case "typed_line":
      return `La ligne « ${b.title} » contient une saisie de ${quantity(b.entered ?? null)}. La correction porterait sa quantité à ${quantity(b.retained ?? null)}.`;
    case "part_not_isolated":
      return "L’historique ne permet pas d’isoler la part de cette lecture. La ligne reste en place.";
    case "quantity_unwritable":
      return "La quantité du devis doit être positive, tenir sur trois décimales et ne pas dépasser 999 999 999,999.";
    case "last_line_protected":
      return `La dernière part appartient à une ligne ${protections[b.line?.reason ?? ""] ?? "protégée"} (« ${b.line?.title ?? "sans titre"} »). Vérifiez-la dans le devis.`;
    case "page_held":
      return "Une autre contribution occupe déjà cette page.";
    case "source_unavailable":
      return "La source retenue ne fournit plus d’apport. Choisissez une autre source.";
    case "identity_conflict":
      return "La quantité corrigée utilise une unité ou une base de mesure différente de celle de la ligne.";
    case "other_analysis":
      return `La lecture ${b.current_reading_revision ?? "en cours"} de ${b.document ?? "ce plan"} retient ${quantity(b.retained ?? null, change?.parts[0]?.unit)}. L’apport de ${b.earlier?.map((p) => `${p.document ?? "ce plan"}, lecture ${p.reading_revision ?? p.job_id}, ${quantity(p.quantity, p.unit)}, pages ${p.pages.join(", ") || "inconnues"}`).join(" et ")} reste au devis. Laissez ce poste de côté ou mesurez-le de nouveau sur tout le plan.`;
    case "addition_plan_required":
      return "Choisissez comment ajouter les postes au devis.";
    case "addition_refused":
      return "Les apports du devis ont changé. Relisez la destination des ajouts avant de confirmer.";
    default:
      return "Cette correction demande une vérification dans le devis.";
  }
}
type PageDecision = NonNullable<RevisionChoices["page_decisions"]>[number];
function PageChoice({
  page,
  onLeaveOut,
  onChoose,
}: {
  page: number | null;
  onLeaveOut?: () => void;
  onChoose: (d: PageDecision) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <fieldset className="space-x-2">
      <legend>{page === null ? "Toutes les pages" : `Page ${page}`}</legend>
      {onLeaveOut && (
        <Button size="xs" variant="outline" onClick={onLeaveOut}>
          Laisser les apports de cette page de côté
        </Button>
      )}
      {(
        [
          ["other_zone", "Autre zone"],
          ["other_trade", "Autre lot"],
        ] as const
      ).map(([reason_code, label]) => (
        <Button
          size="xs"
          variant="outline"
          key={reason_code}
          onClick={() => onChoose({ decision: "keep_both", page, reason_code })}
        >
          Garder les deux · {label}
        </Button>
      ))}
      <label>
        Périmètre complémentaire
        <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <Button
        size="xs"
        variant="outline"
        disabled={note.trim().length < 10}
        onClick={() => onChoose({ decision: "keep_both", page, reason_code: "complementary_scope", note })}
      >
        Garder les deux avec cette justification
      </Button>
    </fieldset>
  );
}
export function RevisionPreview({
  preview: p,
  choices,
  planId,
  busy,
  update,
  onConfirm,
  onItem,
}: {
  preview: Preview;
  choices: RevisionChoices;
  planId: string;
  busy: boolean;
  update: (c: RevisionChoices) => void;
  onConfirm: () => void;
  onItem: (id: string) => void;
}) {
  const add = p.addition_preview;
  const setAdd = (c: NonNullable<RevisionChoices["additions"]>) =>
    update({ ...choices, additions: { ...choices.additions, ...c } });
  const pageChoice = (d: PageDecision, old: PageDecision[] = []) => [...old.filter((x) => x.page !== d.page), d];
  function leaveOut(itemId: string) {
    // A line decision disappears once its item is explicitly omitted.
    const line = p.actions.find((a) => a.item_id === itemId)?.estimate_item_id;
    const lines = Object.fromEntries(Object.entries(choices.lines ?? {}).filter(([key]) => key !== line));
    update({ ...choices, lines, leave_out: [...new Set([...(choices.leave_out ?? []), itemId])] });
  }
  return (
    <fieldset disabled={busy} aria-label="Aperçu de la correction" className="space-y-2 border-t py-2">
      <legend className="font-semibold">Aperçu de la correction du plan</legend>
      {!p.changes.length && <p>Aucune correction à confirmer dans ce devis.</p>}
      {p.changes.map((c) => (
        <div key={c.item_id}>
          <strong>{c.label}</strong> ·{" "}
          {c.action === "add"
            ? "Ajout · aucun apport de ce poste dans cet envoi"
            : c.action === "withdraw"
              ? "Retrait"
              : "Remplacement"}{" "}
          · {c.before_parts.map((b) => quantity(b.quantity, b.unit)).join(" + ") || "0"} →{" "}
          {quantity(c.quantity, c.parts[0]?.unit)}
          {c.before_parts.some((part) => part.pages.length > 0) && (
            <span>
              {" "}
              · pages de l’apport précédent{" "}
              {Array.from(new Set(c.before_parts.flatMap((part) => part.pages))).join(", ")}
            </span>
          )}
          {c.parts.some((part) => part.pages.length > 0) && (
            <span> · pages corrigées {Array.from(new Set(c.parts.flatMap((part) => part.pages))).join(", ")}</span>
          )}
          {c.source && ` · ${sourceNames[c.source]}`}
          {p.left_out.some((l) => l.item_id === c.item_id) ? (
            <>
              {" "}
              · Laissé de côté dans cette correction
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  update({ ...choices, leave_out: choices.leave_out?.filter((id) => id !== c.item_id) })
                }
              >
                Réexaminer {c.label}
              </Button>
            </>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => leaveOut(c.item_id)}>
              Laisser {c.label} de côté
            </Button>
          )}
        </div>
      ))}
      {p.actions.map((a) => (
        <p key={a.estimate_item_id}>
          Ligne « {a.title} » · {quantity(a.quantity_before, a.unit_code)} →{" "}
          {a.quantity_after === null ? "ligne retirée" : quantity(a.quantity_after, a.unit_code)}
          {a.kept_quantity > 0 && ` · autres apports conservés : ${quantity(a.kept_quantity, a.unit_code)}`}
          {a.price_cents !== null &&
            ` · prix unitaire ${(a.price_cents / 100).toLocaleString("fr-FR", { style: "currency", currency: p.currency })}`}
        </p>
      ))}
      {p.blockers.map((b, i) => (
        <div key={i} className="rounded border p-2">
          <p>
            {p.changes.find((c) => c.item_id === b.item_id)?.label}{" "}
            {explanation(
              b,
              p.changes.find((c) => c.item_id === b.item_id),
            )}
          </p>
          {b.reason === "typed_line" && b.line_id && (
            <>
              {(b.reference == null || (b.entered ?? 0) >= (b.retained ?? 0)) && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => update({ ...choices, lines: { ...choices.lines, [b.line_id!]: "keep_entry" } })}
                >
                  Conserver la saisie ({quantity(b.entered ?? null)})
                </Button>
              )}
              <Button
                size="xs"
                variant="outline"
                onClick={() => update({ ...choices, lines: { ...choices.lines, [b.line_id!]: "use_retained" } })}
              >
                Retenir la correction ({quantity(b.retained ?? null)})
              </Button>
            </>
          )}
          {b.pages?.map(
            (pg) =>
              canKeepBoth(b, pg, planId) && (
                <PageChoice
                  key={pg.page ?? "all"}
                  page={pg.page}
                  onChoose={(d) => update({ ...choices, page_decisions: pageChoice(d, choices.page_decisions) })}
                />
              ),
          )}
          {b.item_id && (
            <>
              <Button size="xs" variant="ghost" onClick={() => onItem(b.item_id!)}>
                Voir le poste
              </Button>
            </>
          )}
        </div>
      ))}
      {add && (
        <>
          <ItemSendBreakdownChoice
            value={add.breakdown}
            disabled={busy}
            onChange={(breakdown) => setAdd({ breakdown, resolutions: [], page_decisions: [] })}
          />
          {add.blocked && <ItemSendBlocked blocked={add.blocked} />}
          <ItemSendLines lines={add.lines} />
          {add.invalid_page_decisions.map((d) => (
            <p key={`${d.page}:${d.reason}`} role="alert">
              {d.message}
            </p>
          ))}
          {add.to_resolve.map((point) =>
            point.kind === "page_decision" ? (
              <div key={point.key}>
                <p>
                  Cette page est déjà au devis
                  {point.earlier_lines.length
                    ? ` sur ${point.earlier_lines.map((line) => `« ${line.title ?? "Sans titre"} » (${quantity(line.quantity)})`).join(", ")}`
                    : " par une autre analyse"}
                  .
                </p>
                <PageChoice
                  page={point.page}
                  onLeaveOut={() =>
                    setAdd({
                      resolutions: [
                        ...(choices.additions?.resolutions ?? []).filter((r) => r.key !== point.key),
                        { key: point.key, choice: { kind: "leave_out" } },
                      ],
                      page_decisions: choices.additions?.page_decisions?.filter((d) => d.page !== point.page),
                    })
                  }
                  onChoose={(d) =>
                    setAdd({
                      page_decisions: pageChoice(d, choices.additions?.page_decisions),
                      resolutions: choices.additions?.resolutions?.filter((r) => r.key !== point.key),
                    })
                  }
                />
              </div>
            ) : (
              <ItemSendPoint
                key={point.key}
                point={point}
                choice={null}
                disabled={busy}
                onChoose={(c) =>
                  c.kind === "leave_out" && point.item_id
                    ? leaveOut(point.item_id)
                    : setAdd({
                        resolutions: [
                          ...(choices.additions?.resolutions?.filter((r) => r.key !== point.key) ?? []),
                          {
                            key: point.key,
                            choice: c.kind === "line" ? { kind: c.kind, estimate_item_id: c.estimateItemId } : c,
                          },
                        ],
                      })
                }
              />
            ),
          )}
        </>
      )}
      {Object.keys(choices.lines ?? {}).length > 0 ||
      choices.page_decisions?.length ||
      choices.additions?.resolutions?.length ||
      choices.additions?.page_decisions?.length ? (
        <Button size="xs" variant="ghost" onClick={() => update({ leave_out: choices.leave_out })}>
          Revoir les choix sur les lignes et les pages
        </Button>
      ) : null}
      <Button disabled={busy || !!p.blockers.length || !p.changes.length} onClick={onConfirm}>
        Confirmer la correction
      </Button>
    </fieldset>
  );
}
