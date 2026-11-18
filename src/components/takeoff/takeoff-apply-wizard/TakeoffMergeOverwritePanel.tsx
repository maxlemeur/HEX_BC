"use client";

import { AlertTriangle } from "lucide-react";

import type { MergeEstimateLine, MergeOverwrite } from "@/lib/takeoff/merge-overwrites";

export const MERGE_OVERWRITE_TITLE = "La fusion écraserait des lignes du devis";

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

function measure(quantity: number | string | null, unit: string | null) {
  const value = quantity === null || quantity === "" ? Number.NaN : Number(quantity);
  if (!Number.isFinite(value)) return "sans quantité";
  return unit ? `${quantityFormat.format(value)} ${unit}` : quantityFormat.format(value);
}

/** The unit as the estimate shows it: its code, else the unit an engine 1/2 line writes in its description. */
const lineUnit = (line: MergeEstimateLine) => line.unit_code ?? (line.description?.trim() || null);

/**
 * The re-check of 0fd09a20 (finding 1): on a version that holds a DPGF line, the send merges with the lines of the
 * destination section of the same title and unit (mergeOverwrites). An ordinary line there would lose its quantity and its
 * provenance with no choice: each one is named with its quantity and the one replacing it (several when the database's
 * locale decides which takeoff line lands on it), and the way out is another destination section. The host withholds both
 * confirmations meanwhile.
 */
export function TakeoffMergeOverwritePanel({ overwrites, sectionLabel }: Readonly<{
  overwrites: readonly MergeOverwrite[];
  sectionLabel: string;
}>) {
  if (overwrites.length === 0) return null;
  return (
    <section aria-label={MERGE_OVERWRITE_TITLE} className="space-y-2 rounded-lg border border-danger-border bg-danger-subtle px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        <div className="min-w-0 space-y-2 text-sm">
          <h3 className="font-semibold text-foreground">{MERGE_OVERWRITE_TITLE}</h3>
          <p className="text-foreground">
            Sur un devis avec DPGF, l’envoi fusionne avec les lignes de « {sectionLabel} » de même désignation et de même unité :
            leur quantité et leur provenance seraient remplacées, sans choix possible.
          </p>
          <ul aria-label="Lignes que la fusion écraserait" className="list-disc space-y-1 pl-5 text-foreground">
            {overwrites.map(({ line, sent }) => (
              <li key={line.id} aria-label={line.title ?? "Ligne sans titre"} className="break-words">
                « {line.title ?? "Ligne sans titre"} » : {measure(line.quantity, lineUnit(line))} →{" "}
                {sent.map((entry) => measure(entry.quantity, entry.unit)).join(" ou ")}
              </li>
            ))}
          </ul>
          <p className="font-medium text-foreground">
            Choisissez une autre section de destination : rien n’est envoyé tant que la fusion écraserait ces lignes.
          </p>
        </div>
      </div>
    </section>
  );
}
