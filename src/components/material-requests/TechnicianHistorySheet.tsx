"use client";

import { useEffect, useState } from "react";
import { CopyPlus } from "lucide-react";

import { useToast } from "@/components/feedback/toast-provider";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  fetchTechnicianRequestHistory,
  materialRequestErrorMessage,
  type MaterialRequestHistoryEntry,
} from "@/lib/material-requests/client";
import type { MaterialRequestLine, MaterialRequestLineInput } from "@/lib/material-requests/contracts";

import { formatDateOnly, formatQuantity, lineTitle } from "./format";
import type { SaveResult } from "./useMaterialRequestEditor";

/**
 * A line of a previous request, as a new draft of this one. Its quantity was right for another day:
 * it comes as a figure to check, so it cannot be validated without a look. The acknowledgement of a
 * duplicate and the validation stay behind.
 */
export function copyOfPreviousLine(line: MaterialRequestLine): MaterialRequestLineInput {
  return {
    original_text: line.original_text,
    quantity: line.quantity,
    quantity_doubtful: line.quantity !== null,
    unit: line.unit,
    dimension: line.dimension,
    no_dimension: line.no_dimension,
    product_type: line.product_type,
    material: line.material,
    material_precision: line.material_precision,
    reference: line.reference,
    supplier_id: line.supplier_id,
    zone: line.zone,
    imputation: line.imputation,
    overhead_category: line.overhead_category,
  };
}

type History =
  | { technicianId: string; status: "ready"; items: MaterialRequestHistoryEntry[] }
  | { technicianId: string; status: "error"; message: string };

export function TechnicianHistorySheet({
  open,
  onOpenChange,
  technician,
  currentRequestId,
  canCopy,
  onCopy,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician: { id: string; name: string };
  currentRequestId: string;
  canCopy: boolean;
  onCopy: (line: MaterialRequestLineInput) => Promise<SaveResult>;
}>) {
  const toast = useToast();
  const [history, setHistory] = useState<History | null>(null);
  const [copied, setCopied] = useState<ReadonlySet<string>>(new Set());
  const [copying, setCopying] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const technicianId = technician.id;

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    fetchTechnicianRequestHistory(technicianId, abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) setHistory({ technicianId, status: "ready", items });
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        setHistory({
          technicianId,
          status: "error",
          message: materialRequestErrorMessage(error, "Les demandes précédentes n’ont pas pu être chargées."),
        });
      });
    return () => abort.abort();
  }, [open, technicianId]);

  const current = history?.technicianId === technicianId ? history : null;
  const previous =
    current?.status === "ready" ? current.items.filter((entry) => entry.request.id !== currentRequestId) : [];

  const copy = async (line: MaterialRequestLine) => {
    setCopying(line.id);
    const result = await onCopy(copyOfPreviousLine(line));
    setCopying(null);
    setCopyError(result.ok ? null : result.message);
    if (result.ok) {
      setCopied((done) => new Set(done).add(line.id));
      toast.success({ title: "Ligne recopiée en brouillon", description: "Vérifiez sa quantité." });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader className="pr-12">
          <SheetTitle>Demandes précédentes de {technician.name}</SheetTitle>
          <SheetDescription>
            Ses dix dernières demandes, toutes affaires confondues.
            {canCopy ? " Une ligne recopiée arrive en brouillon, avec sa quantité à vérifier." : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {copyError ? (
            <Alert variant="danger">
              <AlertDescription>{copyError}</AlertDescription>
            </Alert>
          ) : null}
          {current === null ? <LoadingState label="Chargement des demandes précédentes…" /> : null}
          {current?.status === "error" ? (
            <Alert variant="danger">
              <AlertDescription>{current.message}</AlertDescription>
            </Alert>
          ) : null}
          {current?.status === "ready" && previous.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune autre demande de ce technicien.</p>
          ) : null}
          {previous.map((entry) => (
            <section key={entry.request.id} aria-label={`Demande du ${formatDateOnly(entry.request.requested_on)}`}>
              <h3 className="text-sm font-semibold text-foreground">
                {formatDateOnly(entry.request.requested_on)} · {entry.request.project_name}
              </h3>
              {entry.lines.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">Aucune ligne.</p>
              ) : (
                <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
                  {entry.lines.map((line) => (
                    <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <p className="min-w-0 text-sm text-foreground">
                        <span className="font-medium tabular-nums">
                          {[formatQuantity(line.quantity), line.unit].filter(Boolean).join(" ")}
                        </span>{" "}
                        {lineTitle(line)}
                        <span className="block text-xs text-muted-foreground">
                          {[line.material, line.material_precision, line.reference, line.zone]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </p>
                      {canCopy ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          loading={copying === line.id}
                          aria-label={`Recopier : ${lineTitle(line)}`}
                          onClick={() => void copy(line)}
                        >
                          <CopyPlus aria-hidden="true" />
                          {copied.has(line.id) ? "Recopier encore" : "Recopier"}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
