"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Alert } from "@/components/ui/alert";
import { NativeSelect } from "@/components/ui/native-select";
import type { ItemSendPreviewResponse } from "@/lib/takeoff/item-send-contracts";
import { ITEM_SEND_BREAKDOWN_LABELS, ITEM_SEND_BREAKDOWNS, type ItemSendBreakdown } from "@/lib/takeoff/item-send-plan";
import { plural } from "@/lib/text/plural";

// Lot 4, PR 5c: what the preview of the send of one plan by item shows, read only: the draft created or fed, the
// breakdown, the sections, the lines created and fed with their quantities before and after (what other analyses already
// brought, what an earlier send of this same plan brought and this one replaces, what this plan adds), the items and the
// parts that do not leave with their reason, the readings kept and never added, and the mapping rules' effects. Each
// table is a sheet of cells (the shared `data-table` rules), one value per cell.

type Preview = ItemSendPreviewResponse;
type Destination = NonNullable<Preview["destination"]>;

const sourceLabels = { verified_count: "Comptage vérifié", measured: "Mesure retenue", entered: "Saisie du plan" } as const;
const quantity = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
export const formatItemSendQuantity = (value: number | null, unit?: string | null) =>
  value === null ? "" : `${quantity.format(value)}${unit ? ` ${unit}` : ""}`;

const destinationKey = (destination: Destination | null) => (!destination ? ""
  : destination.kind === "first_draft" ? "first" : `draft:${destination.version_id}`);

const UNALLOCATED_REASONS: Record<NonNullable<Preview["lines"][number]["compartment"]["reason"]>, string> = {
  location_unknown: "localisation inconnue",
  location_multiple: "plusieurs localisations",
  location_to_confirm: "localisation à confirmer",
};

const TARGET_LABELS: Record<Preview["lines"][number]["target"], string> = {
  dpgf_line: "ligne du DPGF", earlier_line: "ligne d’un envoi précédent", new_line: "nouvelle ligne",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <h3 id={id} className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function Sheet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="data-table w-full whitespace-nowrap [&_td]:px-2.5 [&_th]:px-2.5" aria-label={label}>{children}</table>
    </div>
  );
}

/** The draft the confirmation creates or feeds, and the choice among the affaire's drafts. */
export function ItemSendDestination({ data, disabled, onChange }: {
  data: Preview; disabled: boolean; onChange: (destination: Destination) => void;
}) {
  const choosable = data.destinations.filter((option) => option.destination !== null);
  return (
    <Section id="item-send-destination" title="Devis">
      {data.destinations.length > 1 ? (
        <div>
          <label htmlFor="item-send-destination-choice" className="block text-xs font-semibold text-foreground-secondary">
            Devis qui reçoit les postes de ce plan
          </label>
          <NativeSelect id="item-send-destination-choice" size="sm" className="mt-1 w-full" disabled={disabled}
            value={destinationKey(data.destination)}
            onChange={(event) => {
              const chosen = choosable.find((option) => destinationKey(option.destination) === event.target.value);
              if (chosen?.destination) onChange(chosen.destination);
            }}>
            <option value="" disabled>Choisir le devis</option>
            {data.destinations.map((option, index) => (
              <option key={option.destination ? destinationKey(option.destination) : `blocked-${index}`}
                value={option.destination ? destinationKey(option.destination) : `blocked-${index}`} disabled={option.destination === null}>
                {option.label}{option.blocked === "issued_only" ? " (émise, reste intacte)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      {data.destination?.kind === "first_draft" ? (
        <p className="text-sm text-foreground" data-testid="item-send-destination">
          L’affaire n’a pas encore de devis : la confirmation crée son premier brouillon (V1), du moteur de calcul 3, et y écrit
          les postes de ce plan.
        </p>
      ) : data.destination ? (
        <p className="text-sm text-foreground" data-testid="item-send-destination">
          Les postes de ce plan alimentent {data.destination_label ?? "le brouillon choisi"} : seules leurs quantités changent, jamais un prix.
        </p>
      ) : null}
    </Section>
  );
}

/** « Ensemble » by default, « Par niveau », « Par bâtiment »: each choice computes the preview again. */
export function ItemSendBreakdownChoice({ value, disabled, onChange }: {
  value: ItemSendBreakdown; disabled: boolean; onChange: (breakdown: ItemSendBreakdown) => void;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-semibold text-foreground">Découpage</legend>
      <div className="flex flex-wrap gap-4">
        {ITEM_SEND_BREAKDOWNS.map((breakdown) => (
          <label key={breakdown} className="flex min-h-9 items-center gap-2 text-sm">
            <input type="radio" name="item-send-breakdown" value={breakdown} checked={value === breakdown} disabled={disabled}
              onChange={() => onChange(breakdown)} />
            {ITEM_SEND_BREAKDOWN_LABELS[breakdown]}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Par niveau ou par bâtiment, chaque poste reçoit une ligne par localisation confirmée du plan ; une localisation inconnue
        va dans « Non réparti ».
      </p>
    </fieldset>
  );
}

/** Why nothing can be confirmed: its reason, and where to act instead (the confirmed import of the DPGF). */
export function ItemSendBlocked({ blocked }: { blocked: NonNullable<Preview["blocked"]> }) {
  return (
    <Alert variant={blocked.reason === "choose_destination" ? "info" : "warning"}>
      <p>{blocked.message}</p>
      {blocked.href ? (
        <p className="mt-2">
          <Link className="font-medium underline underline-offset-2" href={blocked.href}>
            {blocked.reason === "already_sent" ? "Ouvrir le devis sur la ligne écrite" : "Confirmer l’import du DPGF"}
          </Link>
        </p>
      ) : null}
    </Alert>
  );
}

/** The sections the confirmation creates, by the list's lot and family, each by its identity. */
export function ItemSendSectionsCreated({ sections }: { sections: Preview["sections"] }) {
  if (sections.length === 0) return null;
  return (
    <Section id="item-send-sections" title={`Sections créées (${sections.length})`}>
      <ul className="space-y-1 text-sm">
        {sections.map((section) => (
          <li key={section.key} style={{ paddingLeft: `${(section.depth - 1) * 1}rem` }}>
            {section.title}
            {section.homonym_in_draft ? (
              <span className="text-muted-foreground"> · une section du même titre, créée à la main, existe déjà : elle n’est pas reprise</span>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** The lines the confirmation creates or feeds, with every quantity that makes their quantity after. */
export function ItemSendLines({ lines }: { lines: Preview["lines"] }) {
  if (lines.length === 0) return null;
  const withDpgf = lines.some((line) => line.reference !== null);
  return (
    <Section id="item-send-lines" title={`Lignes du devis après l’envoi (${lines.length})`}>
      <p className="text-sm text-muted-foreground">
        « Déjà au devis » : ce que d’autres analyses y ont apporté, conservé. « Remplacé » : ce qu’un envoi précédent y avait apporté
        sur les pages que cet envoi couvre (de ce même plan, ou d’une page que vous remplacez), et qu’il retire. « Apport » : ce que
        ce plan apporte.
      </p>
      <Sheet label="Lignes du devis après l’envoi">
        <thead>
          <tr>
            <th scope="col">Poste</th>
            <th scope="col">Ligne du devis</th>
            <th scope="col">Répartition</th>
            <th scope="col">Avant</th>
            <th scope="col">Déjà au devis</th>
            <th scope="col">Remplacé</th>
            <th scope="col">Apport</th>
            {withDpgf ? <th scope="col">DPGF</th> : null}
            <th scope="col">Après</th>
            <th scope="col">Pages</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} data-testid={`item-send-line-${line.item_id}-${line.compartment.key}`}>
              <th scope="row" className="text-left font-medium">{line.label}</th>
              <td>
                <span className="block max-w-[14rem] truncate" title={line.title ?? undefined}>
                  {line.change === "created" ? "À créer" : line.title ?? "Sans titre"}
                </span>
                <span className="text-xs text-muted-foreground">{TARGET_LABELS[line.target]}</span>
              </td>
              <td>
                {line.compartment.label}
                {line.compartment.reason ? <span className="text-muted-foreground"> · {UNALLOCATED_REASONS[line.compartment.reason]}</span> : null}
              </td>
              <td className="tabular-nums">{line.quantity_before === null ? "—" : formatItemSendQuantity(line.quantity_before, line.unit)}</td>
              <td className="tabular-nums">{line.earlier ? formatItemSendQuantity(line.earlier, line.unit) : "—"}</td>
              <td className="tabular-nums">
                {line.replaced_verified_total ? <>
                  {formatItemSendQuantity(line.replaced_verified_total.quantity, line.replaced_verified_total.unit)}
                  <span className="block text-xs text-muted-foreground">
                    Comptage vérifié de {line.replaced_verified_total.reading_revision == null ? `l’analyse ${line.replaced_verified_total.job_id}`
                      : `la lecture n° ${line.replaced_verified_total.reading_revision}`} · p. {line.replaced_verified_total.pages.join(", ")}
                    {line.replaced_verified_total.corrected_proof ? " · Remplace cet apport dont les repères ont été corrigés depuis sans confirmation." : null}
                  </span>
                </> : line.replaced ? formatItemSendQuantity(line.replaced, line.unit) : "—"}
              </td>
              <td className="tabular-nums">
                {formatItemSendQuantity(line.added, line.unit)}
                {line.quantity_source ? <span className="block text-xs text-muted-foreground">{sourceLabels[line.quantity_source]}</span> : null}
              </td>
              {withDpgf ? (
                <td className="tabular-nums">
                  {line.reference !== null ? formatItemSendQuantity(line.reference, line.unit) : ""}
                  {line.gap?.percent !== null && line.gap?.percent !== undefined ? (
                    <span className={line.gap.requires_review ? "font-medium text-warning" : "text-muted-foreground"}>
                      {` · ${quantity.format(line.gap.percent)} %`}
                    </span>
                  ) : null}
                </td>
              ) : null}
              <td className="tabular-nums font-medium">
                {formatItemSendQuantity(line.quantity_after, line.unit)}
                {line.kept_entry ? <span className="font-normal text-muted-foreground"> · saisie conservée</span> : null}
                {line.rounded_from !== null ? (
                  <span className="font-normal text-muted-foreground"> · arrondi de {formatItemSendQuantity(line.rounded_from)}</span>
                ) : null}
              </td>
              <td className="tabular-nums">{line.pages.length > 0 ? line.pages.join(", ") : "toutes"}</td>
            </tr>
          ))}
        </tbody>
      </Sheet>
      <p className="text-sm text-muted-foreground">
        Les prix, fournisseurs, heures par unité, coefficients, TVA et remises des lignes existantes ne changent pas ; une ligne créée
        n’a pas de prix.
      </p>
    </Section>
  );
}

/** The items of the plan that do not leave, and every part of an answer that does not enter the estimate. */
export function ItemSendNotSent({ data, labels }: { data: Preview; labels: ReadonlyMap<string, string> }) {
  if (data.not_sent.length === 0 && data.parts_not_sent.length === 0 && data.not_added.length === 0) return null;
  return (
    <Section id="item-send-not-sent" title="Ce qui ne part pas">
      {data.not_sent.length > 0 ? (
        <Sheet label="Postes non envoyés">
          <thead><tr><th scope="col">Poste</th><th scope="col">Motif</th></tr></thead>
          <tbody>
            {data.not_sent.map((entry) => (
              <tr key={`${entry.item_id}-${entry.reason}`} data-testid={`item-send-not-sent-${entry.item_id}`}>
                <th scope="row" className="text-left font-medium">{entry.label}</th>
                <td className="whitespace-normal">{entry.message}</td>
              </tr>
            ))}
          </tbody>
        </Sheet>
      ) : null}
      {data.parts_not_sent.length > 0 ? (
        <Sheet label="Parts non envoyées">
          <thead><tr><th scope="col">Poste</th><th scope="col">Pages</th><th scope="col">Quantité</th><th scope="col">Motif</th></tr></thead>
          <tbody>
            {data.parts_not_sent.map((part, index) => (
              <tr key={`${part.item_id}-${part.observation_ids.join(",")}-${index}`}>
                <th scope="row" className="text-left font-medium">{labels.get(part.item_id) ?? "Poste"}</th>
                <td className="tabular-nums">{part.pages.length > 0 ? part.pages.join(", ") : "toutes"}</td>
                <td className="tabular-nums">{formatItemSendQuantity(part.quantity, part.unit)}{part.kind === "entered" ? " saisi" : part.kind === "verified_count" ? " · Comptage vérifié" : ""}</td>
                <td className="whitespace-normal">{part.message}</td>
              </tr>
            ))}
          </tbody>
        </Sheet>
      ) : null}
      {data.not_added.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {plural(data.not_added.length, "lecture conservée", "lectures conservées")} sans être ajoutée{data.not_added.length > 1 ? "s" : ""} :
          une autre lecture d’un objet déjà compté, ou un indice qui n’est pas une mesure.
        </p>
      ) : null}
    </Section>
  );
}

/** What a mapping rule does to an item here: never a price, an ouvrage only named. */
export function ItemSendRules({ rules }: { rules: Preview["rules"] }) {
  const shown = rules.filter((rule) => rule.message);
  if (shown.length === 0) return null;
  return (
    <Section id="item-send-rules" title="Règles de correspondance">
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {shown.map((rule) => (
          <li key={`${rule.item_id}-${rule.effect}`}>
            {rule.label}{rule.rule_name ? ` (« ${rule.rule_name} »)` : ""} : {rule.message}
            {rule.assembly?.name ? ` Ouvrage indiqué : « ${rule.assembly.name} ».` : ""}
          </li>
        ))}
      </ul>
    </Section>
  );
}
