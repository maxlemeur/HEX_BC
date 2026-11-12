"use client";

import { useEffect, useState } from "react";

import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import {
  catalogueErrorMessage,
  fetchSupplierDirectory,
  fetchSupplyTypesWithPreferredSupplier,
  saveSupplyTypePreferredSupplier,
  type SupplierDirectoryEntry,
  type SupplyTypeWithPreferredSupplier,
} from "@/lib/catalogue/supplier-items-client";

import { useSerialSave } from "./useSerialSave";

type TypesState = { status: "loading" } | { status: "error" } | { status: "ready"; items: SupplyTypeWithPreferredSupplier[] };

/** One supply type and its preferred supplier, saved as soon as it is chosen. */
function SupplyTypeRow({
  type,
  suppliers,
  onSaved,
}: Readonly<{
  type: SupplyTypeWithPreferredSupplier;
  suppliers: readonly SupplierDirectoryEntry[];
  onSaved: (saved: SupplyTypeWithPreferredSupplier) => void;
}>) {
  /** The last choice, while its save is on its way: shown until its answer. */
  const [pending, setPending] = useState<{ value: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useSerialSave();
  const stored = type.preferred_supplier_id;
  const shown = pending ? pending.value : stored;
  // A supplier that left the list (deactivated) keeps its name on the type it is still preferred for.
  const unknown = stored !== null && !suppliers.some((supplier) => supplier.id === stored);
  const errorId = `supply-type-${type.id}-error`;

  // Never disabled while it saves: the saves leave one after another, and the last answer speaks.
  const choose = async (supplierId: string | null) => {
    setPending({ value: supplierId });
    setError(null);
    setSaved(false);
    const outcome = await save(() => saveSupplyTypePreferredSupplier(type.id, supplierId));
    // Every answer says what the server holds now, even one a later choice has overtaken.
    if (outcome.ok) {
      onSaved(
        outcome.value ?? {
          ...type,
          preferred_supplier_id: supplierId,
          preferred_supplier_name: suppliers.find((supplier) => supplier.id === supplierId)?.name ?? null,
        },
      );
    }
    if (!outcome.latest) return;
    setPending(null);
    if (outcome.ok) setSaved(true);
    else setError(catalogueErrorMessage(outcome.error, "Le fournisseur privilégié du type n’a pas pu être enregistré."));
  };

  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 break-words text-sm font-medium text-foreground">{type.name}</p>
        <NativeSelect
          wrapperClassName="w-full sm:w-64"
          aria-label={`Fournisseur privilégié, type ${type.name}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={shown ?? ""}
          onChange={(event) => void choose(event.target.value || null)}
        >
          <option value="">Aucun</option>
          {unknown && stored ? <option value={stored}>{type.preferred_supplier_name ?? "Fournisseur retiré de la liste"}</option> : null}
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <p role="status" className="text-xs text-success empty:hidden">
        {saved ? "Enregistré." : ""}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

/**
 * The preferred supplier of each supply type (TI-691, lot 2): proposed on the request lines of every
 * article of the type, after the supplier the technician named and the article's own exception.
 */
export function SupplyTypeSuppliersDialog({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const [types, setTypes] = useState<TypesState>({ status: "loading" });
  const [suppliers, setSuppliers] = useState<SupplierDirectoryEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    fetchSupplyTypesWithPreferredSupplier(abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) setTypes({ status: "ready", items });
      })
      .catch(() => {
        if (!abort.signal.aborted) setTypes({ status: "error" });
      });
    fetchSupplierDirectory(abort.signal)
      .then((entries) => {
        if (!abort.signal.aborted) setSuppliers(entries);
      })
      .catch(() => {
        // The selects then offer « Aucun » and the suppliers already chosen.
      });
    return () => abort.abort();
  }, [open]);

  // The server's answer replaces the row.
  const saved = (stored: SupplyTypeWithPreferredSupplier) =>
    setTypes((current) =>
      current.status === "ready"
        ? { ...current, items: current.items.map((item) => (item.id === stored.id ? stored : item)) }
        : current,
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Types de fourniture</DialogTitle>
          <DialogDescription>
            Le fournisseur privilégié d’un type est proposé sur les demandes de matériel pour tous ses articles,
            après celui nommé par le technicien et l’exception de l’article. Enregistré dès qu’il est choisi.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0">
          {types.status === "loading" ? <p className="text-sm text-muted-foreground">Chargement…</p> : null}
          {types.status === "error" ? (
            <p className="text-sm text-danger">Les types de fourniture n’ont pas pu être chargés.</p>
          ) : null}
          {types.status === "ready" && types.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucun type de fourniture pour le moment. Créez-en un depuis la fiche d’un article, avec « Nouveau type ».
            </p>
          ) : null}
          {types.status === "ready" && types.items.length > 0 ? (
            <ul aria-label="Types de fourniture" className="divide-y divide-border rounded-lg border border-border">
              {types.items.map((type) => (
                <SupplyTypeRow
                  key={type.id}
                  type={type}
                  suppliers={suppliers}
                  onSaved={saved}
                />
              ))}
            </ul>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
