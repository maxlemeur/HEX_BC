"use client";

import { useEffect, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { SupplierCatalogItem } from "@/components/catalogue/types";
import type { EnrichedPrice } from "@/components/catalogue/prices-manager/types";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
      setError("L’URL fournisseur doit commencer par http:// ou https://.");
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
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Modifier la fiche fournisseur</DialogTitle>
          <DialogDescription>
            Ces informations s’appliquent à tous les tarifs de {item?._supplierName} pour{" "}
            {item?._productName}.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="supplier-item-sku">Référence fournisseur</FieldLabel>
            <Input
              id="supplier-item-sku"
              value={supplierSku}
              onChange={(event) => setSupplierSku(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="supplier-item-url">URL fournisseur</FieldLabel>
            <Input
              id="supplier-item-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={productUrl}
              onChange={(event) => setProductUrl(event.target.value)}
            />
          </div>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <DialogFooter>
            <Button variant="outline" size="lg" disabled={isSaving} onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" size="lg" loading={isSaving}>
              Enregistrer la fiche
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
