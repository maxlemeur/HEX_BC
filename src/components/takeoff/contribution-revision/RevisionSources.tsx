"use client";
import { useId, useState } from "react";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";
import { compareQuantityPairs } from "@/lib/takeoff/quantity-policy";
import { Button } from "@/components/ui/button";
import {
  QUANTITY_ENTRY_CATEGORIES,
  quantityEntryError,
  type QuantityEntryCategory,
} from "@/lib/takeoff/quantity-entry";
import type { RevisionItem, RevisionRequest } from "@/lib/takeoff/contribution-revision-contracts";
import { quantity } from "./RevisionQuantities";

type Choose = Extract<RevisionRequest, { action: "choose" }>["choice"];
type Entry = Extract<RevisionRequest, { action: "entry" }>["entry"];

export function RevisionSources({
  item,
  busy,
  measuredAnswer,
  onChoose,
  onEntry,
}: {
  item: RevisionItem;
  busy: boolean;
  measuredAnswer: boolean;
  onChoose: (choice: Choose) => void;
  onEntry: (entry: Entry) => void;
}) {
  const { sources } = item;
  const [amount, setAmount] = useState(String(sources.entry?.quantity ?? ""));
  const [unit, setUnit] = useState(sources.entry?.unit ?? sources.unit ?? "");
  const [category, setCategory] = useState<QuantityEntryCategory | "">(
    (sources.entry?.category as QuantityEntryCategory) ?? "",
  );
  const [note, setNote] = useState(sources.entry?.note ?? "");
  const [reason, setReason] = useState<Extract<Choose, { source: "withdraw" }>["reason"] | "">("");
  const [withdrawNote, setWithdrawNote] = useState("");
  const sourceId = useId();
  const justificationError = useId();
  const input = Number(amount.trim().replace(",", "."));
  const trimmedNote = note.trim();
  const entry = category ? { quantity: input, unit, category, ...(trimmedNote && { note: trimmedNote }) } : null;
  const error = entry && quantityEntryError(entry);
  const hypothesis = sources.entry?.category === "hypothesis" && !sources.entry.included;
  function unavailable(source: string, qty: number, u?: string | null) {
    if (hypothesis) return "Incluez d’abord l’hypothèse du plan.";
    if (measuredAnswer && sources.anomaly) return "La lecture contient une anomalie à vérifier.";
    if (source === "measured" && (!measuredAnswer || sources.mixed_units))
      return "La lecture ne fournit pas une mesure dans une seule unité.";
    if (
      !u ||
      (sources.unit && normalizeMeasurementUnit(sources.unit).unitCode !== normalizeMeasurementUnit(u).unitCode)
    )
      return "L’unité diffère de celle du poste.";
    if (
      sources.reference !== null &&
      sources.reference >= 0 &&
      compareQuantityPairs([{ reference: sources.reference, measured: qty }])?.requiresReview
    )
      return "Cette quantité dépasse la tolérance de la référence DPGF.";
    return null;
  }
  return (
    <fieldset disabled={busy} className="space-y-2">
      <legend className="font-medium">Quantité à retenir pour ce devis</legend>
      {sources.whole_entry ? (
        <p>La saisie pour toute l’affaire gouverne ce poste. Corrigez-la dans le tableau de l’affaire.</p>
      ) : (
        <>
          {hypothesis && (
            <div>
              Cette hypothèse attend votre décision.
              <Button variant="outline" size="xs" onClick={() => onEntry({ action: "include_entry" })}>
                Inclure l’hypothèse du plan
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["measured", "Retenir la mesure", sources.measured, sources.measured_unit],
                [
                  "verified_count",
                  "Retenir le comptage vérifié",
                  sources.verified?.quantity,
                  sources.verified?.unit,
                ],
                ["entered", "Conserver la saisie du plan", sources.entry?.quantity, sources.entry?.unit],
              ] as const
            ).map(([source, label, qty, u]) => {
              if (qty == null || qty <= 0) return null;
              const reason = unavailable(source, qty, u);
              const descriptionId = reason ? `${sourceId}-${source}` : undefined;
              return (
                <div key={source}>
                  <Button
                    variant="outline"
                    size="xs"
                    disabled={!!reason}
                    aria-describedby={descriptionId}
                    onClick={() => onChoose({ source })}
                  >
                    {label} ({quantity(qty, u)})
                  </Button>
                  {reason && <p className="text-xs" id={descriptionId}>{reason}</p>}
                </div>
              );
            })}
          </div>
          <details>
            <summary>Corriger la saisie du plan</summary>
            <p>
              Cette quantité est commune à l’affaire. Chaque devis garde son apport jusqu’à sa propre confirmation.
            </p>
            <div className="flex flex-wrap gap-2">
              <label>
                Quantité du plan
                <input
                  className="form-input"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label>
                Unité
                <input
                  className="form-input"
                  value={unit}
                  maxLength={16}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </label>
              <label>
                Origine
                <select
                  className="form-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as QuantityEntryCategory)}
                >
                  <option value="">Choisir une origine</option>
                  {Object.entries(QUANTITY_ENTRY_CATEGORIES).map(([key, value]) => (
                    <option key={key} value={key}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {category === "hypothesis" ? "Justification obligatoire" : "Justification (facultative)"}
                <input className="form-input" value={note} required={category === "hypothesis"}
                  aria-invalid={!!error} aria-describedby={error ? justificationError : undefined}
                  onChange={(e) => setNote(e.target.value)} />
              </label>
            </div>
            {error && <p id={justificationError}>{error}</p>}
            <Button
              variant="outline"
              size="xs"
              disabled={!entry || !unit.trim() || !(input > 0 && input <= 999999999.999) || !!error}
              onClick={() => entry && onEntry(entry)}
            >
              Enregistrer la saisie du plan
            </Button>
          </details>
        </>
      )}
      {item.sent.length > 0 && (
        <details>
          <summary>Retirer cet apport du devis</summary>
          <label>
            Motif du retrait
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="">Choisir un motif</option>
              <option value="out_of_scope">Hors périmètre</option>
              <option value="duplicate">Doublon</option>
              <option value="reading_error">Erreur de lecture</option>
              <option value="other">Autre motif</option>
            </select>
          </label>
          {reason === "other" && (
            <label>
              Précision
              <input value={withdrawNote} maxLength={500} onChange={(e) => setWithdrawNote(e.target.value)} />
            </label>
          )}
          <Button
            size="xs"
            variant="outline"
            disabled={!reason || (reason === "other" && withdrawNote.trim().length < 3)}
            onClick={() =>
              reason &&
              onChoose({
                source: "withdraw",
                reason,
                ...(reason === "other" ? { note: withdrawNote.trim() } : {}),
              })
            }
          >
            Préparer le retrait
          </Button>
        </details>
      )}
    </fieldset>
  );
}
