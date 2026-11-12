"use client";

import { useId, useState } from "react";
import { Check, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { safeProductUrl } from "@/lib/catalogue/supplier-items-client";
import type { MaterialRequestSupplierOption } from "@/lib/material-requests/client";
import type { MaterialRequestLine, MaterialRequestLineInput } from "@/lib/material-requests/contracts";
import type { LineSupplierProposal, LineSupplierReference } from "@/lib/material-requests/supplier-contracts";

import { ChoiceCell } from "./cells";
import { SUPPLIER_ALREADY_SET, type RetainResult, type SaveResult } from "./useMaterialRequestEditor";

/** Why a supplier is proposed, in a few words read after its name. */
export function supplierReasonLabel(proposal: LineSupplierProposal, supplyTypeName: string | null): string {
  switch (proposal.reason) {
    case "technician":
      // Written at the top of the sheet: a strong hint, that the office may not have confirmed yet.
      return proposal.confirmed ? "nommé par le technicien" : "nommé par le technicien, à confirmer";
    case "article":
      return "exception de l’article";
    case "supply_type":
      return supplyTypeName ? `fournisseur du type ${supplyTypeName}` : "fournisseur du type de fourniture";
    case "last_purchase":
      return "dernier achat";
  }
}

function ReferenceDetails({
  reference,
  supplierName,
}: Readonly<{ reference: LineSupplierReference | null; supplierName: string }>) {
  const sku = reference?.supplier_sku?.trim() || null;
  const url = safeProductUrl(reference?.product_url);
  if (!sku && !url) return null;
  return (
    <div className="min-w-0 space-y-0.5">
      {sku ? <p className="break-all font-mono text-xs text-foreground-secondary">Réf. fournisseur : {sku}</p> : null}
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
  onSave: (patch: MaterialRequestLineInput) => Promise<SaveResult>;
  onRetain: (supplierId: string) => Promise<RetainResult>;
}>;

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
  onSave,
  onRetain,
}: SupplierCellProps) {
  const ids = useId();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The retain found the line already had a supplier (set meanwhile): said until the next gesture. */
  const [alreadySet, setAlreadySet] = useState(false);
  const n = line.position;
  const proposalId = `${ids}-proposal`;

  if (!editable) {
    return (
      <div className="min-w-0 space-y-1">
        <p className="text-sm text-foreground">
          {ownSupplier ?? requestSupplierLabel ?? <span className="text-subtle-foreground">—</span>}
        </p>
        {ownSupplier ? <ReferenceDetails reference={reference} supplierName={ownSupplier} /> : null}
      </div>
    );
  }

  // While the select holds a choice not saved yet, the proposal steps aside: one gesture at a time.
  const shown = !line.supplier_id && !choosing ? proposal : null;

  const retain = async (supplierId: string) => {
    setBusy(true);
    setAlreadySet(false);
    const result = await onRetain(supplierId);
    setBusy(false);
    setError(result.ok ? null : result.message);
    setAlreadySet(result.ok && result.skipped);
  };

  return (
    <div className="min-w-0 space-y-1.5">
      <ChoiceCell
        label={`Fournisseur, ligne ${n}`}
        value={line.supplier_id}
        options={supplierOptions.map((option) => ({ value: option.id, label: option.name }))}
        emptyLabel={requestSupplierLabel ?? "—"}
        unknownLabel="Fournisseur retiré de la liste"
        onUnsavedChange={setChoosing}
        onCommit={async (supplier_id) => {
          setError(null);
          setAlreadySet(false);
          return onSave({ supplier_id });
        }}
      />
      {line.supplier_id && ownSupplier ? <ReferenceDetails reference={reference} supplierName={ownSupplier} /> : null}
      {shown ? (
        <div className="space-y-1 rounded-md border border-dashed border-border px-2 py-1.5">
          <p className="text-micro font-semibold uppercase text-muted-foreground">Proposé</p>
          <div id={proposalId} className="min-w-0 space-y-0.5">
            <p className="break-words text-sm font-medium leading-snug text-foreground">
              {`${shown.supplier_name} · ${supplierReasonLabel(shown, supplyTypeName)}`}
            </p>
            <ReferenceDetails reference={shown} supplierName={shown.supplier_name} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            loading={busy}
            aria-label={`Retenir le fournisseur proposé, ligne ${n}`}
            aria-describedby={proposalId}
            onClick={() => void retain(shown.supplier_id)}
          >
            <Check aria-hidden="true" />
            Retenir
          </Button>
        </div>
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
