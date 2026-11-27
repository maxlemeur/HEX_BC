"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { Check, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { safeProductUrl } from "@/lib/catalogue/supplier-items-client";
import type { MaterialRequestSupplierOption } from "@/lib/material-requests/client";
import type {
  MaterialRequestArticleSummary,
  MaterialRequestLine,
  MaterialRequestLineInput,
} from "@/lib/material-requests/contracts";
import type { LineSupplierProposal, LineSupplierReference } from "@/lib/material-requests/supplier-contracts";
import { cn } from "@/lib/utils";

import { ChoiceCell } from "./cells";
import { formatQuotedPrice } from "./format";
import {
  SUPPLIER_ALREADY_SET,
  type MaterialRequestEditorApi,
  type RetainResult,
  type SaveResult,
} from "./useMaterialRequestEditor";

/** Why a supplier is proposed, in a few words read after its name. */
export function supplierReasonLabel(proposal: LineSupplierProposal, supplyTypeName: string | null): string {
  switch (proposal.reason) {
    case "technician":
      // Written at the top of the sheet: a strong hint, that the office may not have confirmed yet.
      return proposal.confirmed ? "nommé par le technicien" : "nommé par le technicien, à confirmer";
    case "article":
      return "exception de l’article";
    case "supply_type":
      return supplyTypeName ? `fournisseur de la famille ${supplyTypeName}` : "fournisseur de la famille";
    case "last_purchase":
      return "dernier achat";
  }
}

function ReferenceDetails({
  reference,
  supplierName,
  showSku = true,
}: Readonly<{ reference: LineSupplierReference | null; supplierName: string; showSku?: boolean }>) {
  const sku = reference?.supplier_sku?.trim() || null;
  const url = safeProductUrl(reference?.product_url);
  if (!sku && !url) return null;
  return (
    <div className="min-w-0 space-y-0.5">
      {sku && showSku ? <p className="break-all font-mono text-xs text-foreground-secondary">Réf. fournisseur : {sku}</p> : null}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
          Fiche chez {supplierName}
        </a>
      ) : null}
    </div>
  );
}

type SupplierCellProps = Readonly<{
  line: MaterialRequestLine;
  /** The office may change it: a draft or a validated line (choosing a supplier keeps it validated). */
  editable: boolean;
  supplierOptions: readonly MaterialRequestSupplierOption[];
  /** The line's own supplier, by name, when it has one. */
  ownSupplier: string | null;
  /** What a line without its own supplier is bought from: the request's, once confirmed. */
  requestSupplierLabel: string | null;
  /** Only for a line without a supplier: the proposal read for the page. */
  proposal: LineSupplierProposal | null;
  /** The article's reference at the line's own supplier. */
  reference: LineSupplierReference | null;
  supplyTypeName: string | null;
  /** The line's article, when it has one: without it, no supplier is proposed. */
  article: MaterialRequestArticleSummary | null;
  /** The proposals were read for this line as it is now: « none » is then an answer, not a wait. */
  proposalRead: boolean;
  /** Opens the preferred suppliers of the supply types; null for who may not change them. */
  onChooseTypeSupplier: (() => void) | null;
  onSave: (patch: MaterialRequestLineInput) => Promise<SaveResult>;
  onRetain: (supplierId: string) => Promise<RetainResult>;
  /** Adds to the catalogue a supplier typed in the field that the list does not hold, by its name alone. */
  onCreateSupplier: MaterialRequestEditorApi["createSupplier"];
  layout?: "cell" | "inspector";
  /**
   * False in a folded line: the cell is one line, in a card as in the sheet, the supplier or the proposed one beside
   * « Retenir »; the reference, why nothing is proposed and the choice of another supplier are read once unfolded.
   */
  expanded?: boolean;
}>;

/**
 * Why a linked line has no proposed supplier, and where to give it one (TI-691): the preferred supplier of its
 * supply type, set in place by who may change the catalogue, or the supply type the article lacks, on its sheet.
 */
function NoProposal({
  article,
  supplyTypeName,
  onChooseTypeSupplier,
}: Readonly<{
  article: MaterialRequestArticleSummary;
  supplyTypeName: string | null;
  onChooseTypeSupplier: (() => void) | null;
}>) {
  if (!supplyTypeName) {
    return (
      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>Aucun fournisseur proposé : l’article n’a pas de famille.</p>
        <Link
          href={`/dashboard/products?product_id=${encodeURIComponent(article.id)}`}
          className="font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          Ouvrir la fiche de l’article
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-0.5 text-xs text-muted-foreground">
      <p>
        {onChooseTypeSupplier
          ? `Aucun fournisseur proposé : choisissez-en un ci-dessus, ou réglez le fournisseur privilégié de la famille « ${supplyTypeName} ».`
          : `Aucun fournisseur proposé : choisissez-en un ci-dessus. Le fournisseur privilégié de la famille « ${supplyTypeName} » se règle par un administrateur ou un ingénieur (Référentiel › Produits › Familles).`}
      </p>
      {onChooseTypeSupplier ? (
        <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={onChooseTypeSupplier}>
          Choisir le fournisseur de la famille
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The « Fournisseur » column of a line (TI-691). A line with a supplier shows it with the article's
 * reference there; one without shows the proposed supplier, why, and « Retenir ». The select stays: the
 * office may always choose another one. A reader sees the supplier and nothing that writes.
 */
export function MaterialRequestSupplierCell({
  line,
  editable,
  supplierOptions,
  ownSupplier,
  requestSupplierLabel,
  proposal,
  reference,
  supplyTypeName,
  article,
  proposalRead,
  onChooseTypeSupplier,
  onSave,
  onRetain,
  onCreateSupplier,
  layout = "cell",
  expanded = true,
}: SupplierCellProps) {
  const ids = useId();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The retain found the line already had a supplier (set meanwhile): said until the next gesture. */
  const [alreadySet, setAlreadySet] = useState(false);
  /** The supplier this cell just added to the catalogue: only its name is known there. */
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const n = line.position;
  const proposalId = `${ids}-proposal`;
  // Built once for the same suppliers, not at every render of every line: the combobox indexes what it is given.
  // The name is a keyword besides the label: a homonym's label carries a mark, and its name must not be created again.
  const choices = useMemo(
    () => supplierOptions.map((option) => ({ value: option.id, label: option.label, keywords: [option.name] })),
    [supplierOptions],
  );
  const creation = useMemo(
    () => ({
      label: (name: string) => `Créer le fournisseur « ${name} »`,
      run: async (name: string) => {
        const result = await onCreateSupplier(name);
        if (!result.ok) return result;
        setCreated({ id: result.id, name });
        return { ok: true as const, value: result.id };
      },
    }),
    [onCreateSupplier],
  );

  // A line priced by a retained quote (TI-691) is bought from that quote's supplier: it no longer changes.
  if (!editable || line.price_quote_id) {
    if (layout === "inspector") {
      const values = [
        ["Fournisseur", ownSupplier ?? requestSupplierLabel ?? "Non renseigné"],
        ...(reference?.supplier_sku ? [["Réf. fournisseur", reference.supplier_sku]] : []),
        ...(line.unit_price_ht_cents !== null ? [["Prix unitaire HT (devis retenu)", formatQuotedPrice(line.unit_price_ht_cents, line.price_per)]] : []),
      ];
      return <div className="space-y-3"><dl className="space-y-3 text-sm">{values.map(([name, value]) => <div key={name} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4"><dt className="text-muted-foreground">{name}</dt><dd className="min-w-0 break-words font-medium text-foreground">{value}</dd></div>)}</dl>{ownSupplier ? <ReferenceDetails reference={reference} supplierName={ownSupplier} showSku={false} /> : null}</div>;
    }
    return (
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-foreground">
          {ownSupplier ?? requestSupplierLabel ?? <span className="text-subtle-foreground">—</span>}
        </p>
        {ownSupplier ? <ReferenceDetails reference={reference} supplierName={ownSupplier} /> : null}
        {line.unit_price_ht_cents !== null ? (
          <p className="text-xs tabular-nums text-foreground-secondary">
            {`Prix unitaire HT : ${formatQuotedPrice(line.unit_price_ht_cents, line.price_per)} (devis retenu)`}
          </p>
        ) : null}
      </div>
    );
  }

  // While the select holds a choice not saved yet, the proposal steps aside: one gesture at a time.
  const shown = !line.supplier_id && !choosing ? proposal : null;
  // A homonym is shown as the pickers show it.
  const shownLabel = shown ? (supplierOptions.find((option) => option.id === shown.supplier_id)?.label ?? shown.supplier_name) : null;
  const missing = !line.supplier_id && !choosing && line.product_id !== null && article !== null && proposalRead && proposal === null;

  const retain = async (supplierId: string) => {
    setBusy(true);
    setAlreadySet(false);
    const result = await onRetain(supplierId);
    setBusy(false);
    setError(result.ok ? null : result.message);
    setAlreadySet(result.ok && result.skipped);
  };

  return (
    // In the lines sheet the select fills the cell, as a field does; what is read under it keeps a padding. Folded,
    // a proposal takes the place of the select: one gesture retains it, and another supplier is chosen once unfolded.
    <div
      className={cn(
        "min-w-0 space-y-1.5 sheet:space-y-1",
        layout === "cell" && "sheet:[&>:not([data-slot=combobox])]:mx-2.5",
        !expanded && "space-y-0 sheet:space-y-0",
        expanded && layout === "cell" && "sheet:pb-1.5",
        // Unfolded in the sheet, a line parts the select from what is read under it.
        expanded && layout === "cell" && "sheet:[&>[data-slot=combobox]]:border-b sheet:[&>[data-slot=combobox]]:border-border",
        !expanded && shown && "[&>[data-slot=combobox]]:hidden",
      )}
    >
      <ChoiceCell
        label={`Fournisseur, ligne ${n}`}
        value={line.supplier_id}
        options={choices}
        emptyLabel={requestSupplierLabel ?? "—"}
        unknownLabel="Fournisseur retiré de la liste"
        searchable
        placeholder={requestSupplierLabel ? "Chercher un autre…" : "Chercher…"}
        onUnsavedChange={setChoosing}
        create={creation}
        onCommit={async (supplier_id) => {
          setError(null);
          setAlreadySet(false);
          return onSave({ supplier_id });
        }}
      />
      {/* Read once the line is unfolded: what it is bought from while it names no supplier, and the article's reference there. */}
      {expanded && !line.supplier_id && requestSupplierLabel ? (
        <p className="text-xs text-foreground-secondary">{`Acheté chez : ${requestSupplierLabel}`}</p>
      ) : null}
      {expanded && line.supplier_id && ownSupplier ? <ReferenceDetails reference={reference} supplierName={ownSupplier} /> : null}
      {/*
        A supplier just created is a name: its address, contact and SIRET are filled on its sheet, in another tab.
        Read once the line is unfolded, as the rest of what is under the select: a folded row keeps its height.
      */}
      {expanded && created && line.supplier_id === created.id ? (
        <p className="text-xs text-muted-foreground">
          {"Nouveau fournisseur, connu par son nom seul. "}
          <a
            href={`/dashboard/suppliers?fiche=${encodeURIComponent(created.id)}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Compléter la fiche de ${created.name}`}
            className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
            Compléter sa fiche
          </a>
        </p>
      ) : null}
      {shown ? (
        // Folded, the proposal is one line and its gesture; unfolded, it is read in full. Neutral either way: a
        // proposal is not an alert.
        <div
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1",
            expanded ? "rounded-md border border-dashed border-border-strong bg-surface-subtle px-2 py-1.5" : "min-h-9",
          )}
        >
          <p className={cn("text-micro font-semibold uppercase text-muted-foreground", !expanded && "sr-only")}>Proposé</p>
          <div id={proposalId} className={cn("min-w-0 space-y-0.5", expanded ? "col-span-2 row-start-2" : "contents")}>
            <p
              className={cn(
                "font-medium leading-snug text-foreground",
                expanded
                  ? "break-words text-sm"
                  : "row-start-1 truncate text-sm font-normal italic text-foreground-secondary",
              )}
              title={expanded ? undefined : `Proposé : ${shownLabel} · ${supplierReasonLabel(shown, supplyTypeName)}`}
            >
              {`${shownLabel} · ${supplierReasonLabel(shown, supplyTypeName)}`}
            </p>
            {expanded ? <ReferenceDetails reference={shown} supplierName={shown.supplier_name} /> : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="col-start-2 row-start-1"
            loading={busy}
            aria-label={`Retenir le fournisseur proposé, ligne ${n}`}
            aria-describedby={proposalId}
            onClick={() => void retain(shown.supplier_id)}
          >
            {expanded ? <Check aria-hidden="true" /> : null}
            Retenir
          </Button>
        </div>
      ) : null}
      {/* Why nothing is proposed, and where to settle it, are read once the line is unfolded. */}
      {expanded && missing && article ? (
        <NoProposal article={article} supplyTypeName={supplyTypeName} onChooseTypeSupplier={onChooseTypeSupplier} />
      ) : null}
      <p role="status" className="text-xs text-muted-foreground empty:hidden">
        {alreadySet ? SUPPLIER_ALREADY_SET : ""}
      </p>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">
          Non enregistré : {error}
        </p>
      ) : null}
    </div>
  );
}
