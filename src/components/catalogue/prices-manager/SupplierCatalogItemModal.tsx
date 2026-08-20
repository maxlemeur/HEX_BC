"use client";

import { useEffect, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { SupplierCatalogItem } from "@/components/catalogue/types";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { Modal } from "@/components/ui-legacy/Modal";
import { useToast } from "@/components/ui-legacy/Toast";

type SupplierCatalogItemModalProps = {
  item: EnrichedPrice | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

function isHttpUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function SupplierCatalogItemModal({
  item,
  onClose,
  onSaved,
}: Readonly<SupplierCatalogItemModalProps>) {
  const toast = useToast();
  const [supplierSku, setSupplierSku] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!item) return;
    setSupplierSku(item.supplier_sku ?? "");
    setProductUrl(item.product_url ?? "");
    setError(null);
    setIsSaving(false);
  }, [item]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item?.supplier_catalog_item_id) {
      setError("La fiche article–fournisseur est introuvable.");
      return;
    }
    if (!isHttpUrl(productUrl)) {
      setError("L'URL fournisseur doit commencer par http:// ou https://.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await fetchApi<{ item: SupplierCatalogItem }>("/api/prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-supplier-item",
          id: item.supplier_catalog_item_id,
          supplier_sku: supplierSku.trim() || null,
          product_url: productUrl.trim() || null,
        }),
      });
      toast.success({ title: "Fiche fournisseur mise à jour." });
      onClose();
      await onSaved();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible de mettre à jour la fiche fournisseur.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal.Root
      open={item !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal.Content className="max-w-xl">
        <Modal.Header>
          <div>
            <Modal.Title>Modifier la fiche fournisseur</Modal.Title>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Ces informations s&apos;appliquent à tous les tarifs de{" "}
              {item?._supplierName} pour {item?._productName}.
            </p>
          </div>
        </Modal.Header>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-1.5 text-xs font-semibold text-[var(--slate-700)]">
            Référence fournisseur
            <input
              className="form-input"
              value={supplierSku}
              onChange={(event) => setSupplierSku(event.target.value)}
            />
          </label>
          <label className="block space-y-1.5 text-xs font-semibold text-[var(--slate-700)]">
            URL fournisseur
            <input
              className="form-input"
              type="url"
              value={productUrl}
              onChange={(event) => setProductUrl(event.target.value)}
            />
          </label>
          {error ? (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-3 pt-2">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={isSaving}
              onClick={onClose}
            >
              Annuler
            </button>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={isSaving}
            >
              {isSaving ? "Enregistrement..." : "Enregistrer la fiche"}
            </button>
          </div>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
