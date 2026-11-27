"use client";

import { useMemo, useState, type FormEvent } from "react";

import { fetchApi } from "@/components/catalogue/api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  SUPPLIER_BASE_FILE_TOO_LARGE, SUPPLIER_BASE_MAX_FILE_BYTES,
  type SupplierBaseGap, type SupplierBaseGroup, type SupplierBasePlannedRow, type SupplierBasePreview, type SupplierBaseRow,
} from "@/lib/catalogue/supplier-base-contract";

const GROUPS = [
  { key: "known", label: "Références connues" },
  { key: "proposed", label: "Rapprochements proposés" },
  { key: "new", label: "Nouveaux articles potentiels" },
] as const;
const ISSUE_LABELS = {
  missing_supplier: "Fournisseur manquant",
  missing_designation: "Désignation manquante",
  missing_reference: "Référence manquante",
  duplicate_reference: "Référence en double chez ce fournisseur",
  invalid_price: "Prix illisible",
  inexact_price: "Le prix pour 100 unités comporte une fraction de centime",
  price_cents_overflow: "Prix supérieur au montant maximal du catalogue",
  missing_price_date: "Date du prix manquante",
  invalid_price_date: "Date du prix illisible",
  future_price_date: "Date du prix dans le futur",
  inactive_price_same_date: "Un prix désactivé existe à cette date",
  unknown_price_unit: "Unité de prix à préciser",
  invalid_packaging_quantity: "Quantité par conditionnement illisible ou invalide",
  invalid_packaging_price: "Prix du conditionnement illisible",
  packaging_price_mismatch: "Le prix du conditionnement diffère du prix multiplié par sa quantité",
};
const GAP_LABELS = {
  dimension_unknown: "Dimension à confirmer",
  material_unknown: "Matière à confirmer",
  unit_unknown: "Unité à confirmer",
  unit_mismatch: "Unités différentes",
  type_unknown: "Type d’article à confirmer",
  precision_check: "Nuance ou norme à vérifier",
  draft_article: "Article en brouillon",
  missing_article: "Article de la référence introuvable",
  pending_reference: "Référence déjà à vérifier",
  archived_article_or_reference: "Article ou référence archivé",
  article_not_editable: "Article hors de vos droits de modification",
  ambiguous_reference: "Plusieurs articles portent déjà cette référence chez ce fournisseur",
  supplier_reference_exists: "Ce fournisseur a déjà une référence pour cet article",
  supplier_reference_inactive: "La référence de ce fournisseur est inactive",
  packaging_differs: "Conditionnements différents. Le conditionnement habituel sera à choisir.",
  same_supplier_same_article: "Plusieurs lignes de ce fournisseur visent le même article. Une seule référence est possible.",
} satisfies Record<SupplierBaseGap, string>;
const FRAGILE_LABELS = {
  old_version_missing_document: "Ancienne version, document manquant",
  ocr_scan: "Lecture OCR",
  price_per_100: "Prix pour 100 unités",
};
const PRICE_ACTION_LABELS = {
  none: null,
  add: "Prix à ajouter",
  skip: "Date égale ou antérieure au prix existant",
  review: "Prix à vérifier",
  per_lot: "Prix pour 100 unités à confirmer",
};
const SKIPPED_SHEET_LABELS = {
  index: "Sommaire",
  summary: "Récapitulatif",
  rental: "Locations",
  hidden: "Feuille masquée",
};
const UNRESOLVED_LABELS = {
  unknown: "Fournisseur inconnu",
  ambiguous: "Plusieurs fournisseurs possibles",
  inactive_alias: "Nom associé à un fournisseur inactif",
  missing_name: "Nom à renseigner",
};
const MONEY = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeZone: "UTC" });
const number = (value: number) => value.toLocaleString("fr-FR");
const dateLabel = (date: string) => DATE.format(new Date(`${date}T00:00:00Z`));
const sourceKey = (sheet: string, row: number) => JSON.stringify([sheet, row]);

type PreviewLookup = {
  articles: Map<string, SupplierBasePreview["articles"][number]>;
  workbookRows: Map<string, SupplierBaseRow>;
};

function supplierLabel(supplier: SupplierBaseGroup) {
  return supplier.supplier_label ?? (supplier.workbook_names.join(", ") || "Fournisseur sans nom");
}

function PreviewRow({ item, lookup }: { item: SupplierBasePlannedRow; lookup: PreviewLookup }) {
  const { row, known_reference, proposals, gaps, price_action } = item;
  const article = known_reference ? lookup.articles.get(known_reference.article_id) : undefined;
  const action = PRICE_ACTION_LABELS[price_action];
  return (
    <tr className="border-t border-border align-top [&>td]:px-3 [&>td]:py-2.5 [&>th]:px-3 [&>th]:py-2.5">
      <th scope="row" className="w-[30%] text-left font-normal">
        <div className="break-words font-medium">{row.designation ?? "Désignation manquante"}</div>
        {row.supplier_reference && <div className="break-all font-mono text-xs">{row.supplier_reference}</div>}
        <div className="text-xs text-muted-foreground">{row.sheet}, ligne {row.row}</div>
      </th>
      <td className="w-[23%]">
        {row.price
          ? <div>
              {row.price.decimal.replace(".", ",")} €
              {row.price.per === 100 ? " pour 100 unités" : row.price_unit ? ` / ${row.price_unit}` : " par unité"}
              {row.price.lot_price && (
                <div className="text-xs text-muted-foreground">
                  {MONEY.format(row.price.lot_price.amount_cents / 100)} pour {number(row.price.lot_price.units)} unités
                </div>
              )}
            </div>
          : <div className="text-muted-foreground">Sans prix exploitable</div>}
        {row.price_date && <div>{dateLabel(row.price_date)}</div>}
        {row.document && <div className="break-words text-muted-foreground">
          {"text" in row.document ? row.document.text : `${row.document.kind} ${row.document.number}`}
        </div>}
        {row.packaging_label && <div className="break-words">{row.packaging_label}{row.packaging_quantity !== null ? ` (× ${number(row.packaging_quantity)})` : ""}</div>}
        {action && <div className="mt-1 text-xs text-muted-foreground">{action}</div>}
      </td>
      <td>
        {article && (
          <div className="break-words">
            {article.designation}{article.reference ? ` · ${article.reference}` : ""}
            {known_reference?.latest_price_date && (
              <div className="text-xs text-muted-foreground">Dernier prix actif le {dateLabel(known_reference.latest_price_date)}</div>
            )}
          </div>
        )}
        {proposals.length > 0 && (
          <ul className="space-y-2">
            {proposals.map((proposal) => {
              const key = proposal.source === "catalogue" ? proposal.article_id : sourceKey(proposal.sheet, proposal.row);
              const target = proposal.source === "catalogue" ? lookup.articles.get(key) : undefined;
              const peer = proposal.source === "workbook" ? lookup.workbookRows.get(key) : undefined;
              return <li key={key}>
                <div className="break-words font-medium">{target?.designation ?? peer?.designation}</div>
                <div className="break-words text-xs text-muted-foreground">
                  {proposal.source === "catalogue"
                    ? target?.reference ? `Catalogue · ${target.reference}` : "Catalogue"
                    : `${peer?.supplier_name ? `${peer.supplier_name} · ` : ""}${proposal.sheet}, ligne ${proposal.row}`}
                </div>
                {proposal.gaps.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {proposal.gaps.map((gap) => <li key={gap}>{GAP_LABELS[gap]}</li>)}
                </ul>}
              </li>;
            })}
          </ul>
        )}
        {row.fragile && <Badge variant="outline" className="my-1">À vérifier</Badge>}
        {(gaps.length > 0 || row.issues.length > 0 || row.fragile) && (
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {row.fragile_reasons.map((reason) => <li key={reason}>{FRAGILE_LABELS[reason]}</li>)}
            {row.issues.map((issue) => <li key={issue}>{ISSUE_LABELS[issue]}</li>)}
            {gaps.map((gap) => <li key={gap}>{GAP_LABELS[gap]}</li>)}
          </ul>
        )}
        {(row.observations || row.source_file_text) && (
          <details className="mt-1 break-words text-xs text-muted-foreground">
            <summary className="cursor-pointer">Provenance et observations</summary>
            {row.source_file_text && <p>{row.source_file_text}</p>}
            {row.observations && <p>{row.observations}</p>}
          </details>
        )}
      </td>
    </tr>
  );
}

function PreviewGroup({ label, rows, lookup }: { label: string; rows: SupplierBasePlannedRow[]; lookup: PreviewLookup }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <h2 className="flex items-center gap-2 px-4 py-3 font-semibold">
        {label} <Badge variant="outline">{number(rows.length)}</Badge>
      </h2>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table aria-label={label} className="w-full min-w-[42rem] table-fixed border-collapse text-sm">
            <thead className="bg-surface-subtle text-left text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2">
                <th scope="col">Ligne du classeur</th>
                <th scope="col">Prix et conditionnement</th>
                <th scope="col">Rapprochement et points à vérifier</th>
              </tr>
            </thead>
            <tbody>{rows.map((row) => <PreviewRow key={sourceKey(row.row.sheet, row.row.row)} item={row} lookup={lookup} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function SupplierBasePreviewForm() {
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<SupplierBasePreview | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const lookup = useMemo<PreviewLookup>(() => {
    const workbookRows = new Map<string, SupplierBaseRow>();
    for (const supplier of preview?.suppliers ?? []) {
      for (const { key } of GROUPS) {
        for (const { row } of supplier[key]) workbookRows.set(sourceKey(row.sheet, row.row), row);
      }
    }
    return {
      articles: new Map(preview?.articles.map((article) => [article.id, article])),
      workbookRows,
    };
  }, [preview]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || pending) return;
    setError(null);
    setPreview(null);
    if (file.size > SUPPLIER_BASE_MAX_FILE_BYTES) {
      setError(SUPPLIER_BASE_FILE_TOO_LARGE);
      return;
    }
    const body = new FormData();
    body.set("file", file);
    setPending(true);
    try {
      const plan = await fetchApi<SupplierBasePreview>("/api/catalogue/supplier-base/preview", { method: "POST", body });
      setSelectedKey(plan.suppliers[0]?.key ?? "");
      setPreview(plan);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Aperçu indisponible.");
    } finally {
      setPending(false);
    }
  }

  const supplier = preview?.suppliers.find(({ key }) => key === selectedKey);
  const unresolved = preview?.suppliers.flatMap((entry) => entry.resolution === "recognized"
    ? [] : [{ entry, reason: UNRESOLVED_LABELS[entry.resolution] }]) ?? [];
  return (
    <div className="space-y-5">
      <form onSubmit={upload} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="w-full space-y-1 sm:max-w-md">
          <Label htmlFor="supplier-base-file">Classeur Excel (.xlsx, 4 Mo max.)</Label>
          <Input
            id="supplier-base-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={pending}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setError(null);
              setPreview(null);
            }}
          />
        </div>
        <Button type="submit" disabled={!file || pending}>{pending ? "Lecture en cours…" : "Prévisualiser"}</Button>
      </form>
      {error && <Alert variant="danger">{error}</Alert>}
      {preview && supplier && (
        <>
          <p role="status" className="text-sm text-muted-foreground">{number(preview.row_count)} lignes lues.</p>
          {preview.skipped_sheets.length > 0 && (
            <div className="text-sm text-muted-foreground">
              <p className="font-medium">Feuilles ignorées</p>
              <ul className="list-disc pl-4">
                {preview.skipped_sheets.map(({ name, reason }) => <li key={name}>{name} · {SKIPPED_SHEET_LABELS[reason]}</li>)}
              </ul>
            </div>
          )}
          {preview.sheet_warnings.length > 0 && (
            <Alert variant="warning">
              <p className="font-semibold">Colonnes facultatives absentes</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {preview.sheet_warnings.map(({ sheet, missing_optional_columns }) => (
                  <li key={sheet}>{sheet} · {missing_optional_columns.join(", ")}</li>
                ))}
              </ul>
            </Alert>
          )}
          {unresolved.length > 0 && (
            <Alert variant="warning" hideIcon>
              <p className="font-semibold">Fournisseurs à associer</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {unresolved.map(({ entry, reason }) => (
                  <li key={entry.key}>
                    {supplierLabel(entry)} · {reason}
                    {entry.candidates.length > 0 ? ` (${entry.candidates.map(({ label }) => label).join(", ")})` : ""}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          <div className="max-w-md space-y-1">
            <Label htmlFor="supplier-base-group">Fournisseur</Label>
            <NativeSelect id="supplier-base-group" value={supplier.key} onChange={(event) => setSelectedKey(event.target.value)}>
              {preview.suppliers.map((entry) => (
                <option key={entry.key} value={entry.key}>{supplierLabel(entry)}</option>
              ))}
            </NativeSelect>
          </div>
          {GROUPS.map(({ key, label }) => <PreviewGroup key={key} label={label} rows={supplier[key]} lookup={lookup} />)}
        </>
      )}
    </div>
  );
}
