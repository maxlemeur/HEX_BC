"use client";

import { useCallback, useRef, useState } from "react";
import useSWR from "swr";
import { BriefcaseIcon, PencilIcon, PlusIcon, RotateCwIcon, SearchIcon, TrashIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import { ReferentielFormField } from "@/components/catalogue/ReferentielFormField";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { EmptyState, EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { SortOption } from "@/components/TableFilterBar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type Supplier = {
  id: string;
  created_at: string;
  name: string;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  contact_name: string | null;
  siret: string | null;
  vat_number: string | null;
  payment_terms: string | null;
  is_active: boolean;
};

// Sort options
const SUPPLIERS_SORT_OPTIONS: SortOption[] = [
  { key: "name", label: "Nom", defaultDirection: "asc" },
  { key: "city", label: "Ville" },
  { key: "created_at", label: "Date d'ajout", defaultDirection: "desc" },
];

type SupplierFormState = {
  name: string;
  address: string;
  city: string;
  postal_code: string;
  country: string;
  email: string;
  phone: string;
  contact_name: string;
  siret: string;
  vat_number: string;
  payment_terms: string;
};

const EMPTY_FORM: SupplierFormState = {
  name: "",
  address: "",
  city: "",
  postal_code: "",
  country: "France",
  email: "",
  phone: "",
  contact_name: "",
  siret: "",
  vat_number: "",
  payment_terms: "",
};

const TABLE_COLUMNS = 6;

export default function SuppliersPage() {
  const confirm = useConfirm();
  // Form state
  const [formState, setFormState] = useState<SupplierFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const nameFieldRef = useRef<HTMLInputElement | null>(null);

  // Filtered suppliers state
  const [displayedSuppliers, setDisplayedSuppliers] = useState<Supplier[]>([]);

  const fetchSuppliers = useCallback(async () => {
    const data = await fetchApi<{ items: Supplier[] }>("/api/suppliers");
    return data.items;
  }, []);

  const {
    data: suppliers = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<Supplier[]>("suppliers", fetchSuppliers, {
    refreshInterval: 30000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
  });

  const closeForm = useCallback(() => {
    setIsFormOpen(false);
    setFormError(null);
    setIsSubmitting(false);
    setEditingId(null);
    setFormState(EMPTY_FORM);
  }, []);

  const openCreateForm = useCallback(() => {
    setFormError(null);
    setIsSubmitting(false);
    setEditingId(null);
    setFormState(EMPTY_FORM);
    setIsFormOpen(true);
  }, []);

  const openEditForm = useCallback((supplier: Supplier) => {
    setFormError(null);
    setIsSubmitting(false);
    setEditingId(supplier.id);
    setFormState({
      name: supplier.name ?? "",
      address: supplier.address ?? "",
      city: supplier.city ?? "",
      postal_code: supplier.postal_code ?? "",
      country: supplier.country ?? "France",
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      contact_name: supplier.contact_name ?? "",
      siret: supplier.siret ?? "",
      vat_number: supplier.vat_number ?? "",
      payment_terms: supplier.payment_terms ?? "",
    });
    setIsFormOpen(true);
  }, []);

  function updateField<K extends keyof SupplierFormState>(
    key: K,
    value: SupplierFormState[K]
  ) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const payload = {
      name: formState.name.trim(),
      address: formState.address.trim() || null,
      city: formState.city.trim() || null,
      postal_code: formState.postal_code.trim() || null,
      country: formState.country.trim() || null,
      email: formState.email.trim() || null,
      phone: formState.phone.trim() || null,
      contact_name: formState.contact_name.trim() || null,
      siret: formState.siret.trim() || null,
      vat_number: formState.vat_number.trim() || null,
      payment_terms: formState.payment_terms.trim() || null,
      is_active: true,
    };

    try {
      await fetchApi("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingId
            ? { action: "update", id: editingId, item: payload }
            : { action: "create", item: payload }
        ),
      });
      await mutate();
      closeForm();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Enregistrement impossible."
      );
      setIsSubmitting(false);
    }
  }

  async function onDelete(supplier: Supplier) {
    setPageError(null);
    try {
      const usage = await fetchApi<{ linked_orders_count: number }>(
        `/api/suppliers?view=usage&id=${encodeURIComponent(supplier.id)}`
      );
      const linkedOrdersCount = usage.linked_orders_count;
      const hasLinkedOrders = linkedOrdersCount > 0;
      const isPlural = linkedOrdersCount > 1;

      const confirmed = await confirm(
        hasLinkedOrders
          ? {
              title: `Archiver « ${supplier.name} » ?`,
              description: `Ce fournisseur est utilisé dans ${linkedOrdersCount} bon${isPlural ? "s" : ""} de commande. Il sera archivé et retiré de la liste active ; ses bons de commande sont conservés.`,
              confirmLabel: "Archiver",
              tone: "danger",
            }
          : {
              title: `Supprimer « ${supplier.name} » ?`,
              description: "Ce fournisseur n’est lié à aucun bon de commande : il sera supprimé du référentiel.",
              confirmLabel: "Supprimer",
              tone: "danger",
            }
      );
      if (!confirmed) return;

      await fetchApi("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id: supplier.id }),
      });
      await mutate();
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "Suppression impossible."
      );
    }
  }

  const emptyTitle = suppliers.length === 0 ? "Aucun fournisseur" : "Aucun résultat";
  const emptyDescription =
    suppliers.length === 0
      ? "Ajoutez un fournisseur pour démarrer."
      : "Modifiez vos filtres pour voir plus de résultats.";
  const emptyIcon = suppliers.length === 0 ? <BriefcaseIcon /> : <SearchIcon />;
  const emptyAction =
    suppliers.length === 0 ? (
      <Button leftIcon={<PlusIcon aria-hidden="true" />} onClick={openCreateForm}>
        Ajouter un fournisseur
      </Button>
    ) : null;

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Référentiel", href: "/dashboard/referentiel" },
          { label: "Fournisseurs" },
        ]}
        title="Fournisseurs"
        description="Gérez la liste de vos fournisseurs et leurs coordonnées."
        actions={
          <Button
            size="lg"
            className="w-full sm:w-auto"
            leftIcon={<PlusIcon aria-hidden="true" />}
            onClick={openCreateForm}
          >
            Ajouter un fournisseur
          </Button>
        }
      />

      {pageError ? (
        <Alert variant="danger" className="mb-6">
          {pageError}
        </Alert>
      ) : null}

      <Dialog
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) closeForm();
        }}
      >
        <DialogContent size="xl" initialFocus={nameFieldRef} data-supplier-modal-root>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Modifier le fournisseur" : "Ajouter un fournisseur"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Mettez à jour les informations du fournisseur."
                : "Renseignez les informations du nouveau fournisseur. Seul le nom est obligatoire."}
            </DialogDescription>
          </DialogHeader>

          <form className="flex min-h-0 flex-col gap-4" onSubmit={onSubmit}>
            <DialogBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <ReferentielFormField
                ref={nameFieldRef}
                id="supplier-name"
                label="Nom *"
                className="sm:col-span-2 lg:col-span-3"
                name="organization"
                autoComplete="organization"
                placeholder="Nom de l’entreprise"
                required
                value={formState.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-contact"
                label="Contact"
                name="contact-name"
                autoComplete="name"
                placeholder="Nom du contact"
                value={formState.contact_name}
                onChange={(event) => updateField("contact_name", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-phone"
                label="Téléphone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="01 00 00 00 00"
                value={formState.phone}
                onChange={(event) => updateField("phone", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-email"
                label="Email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="contact@fournisseur.fr"
                value={formState.email}
                onChange={(event) => updateField("email", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-address"
                label="Adresse"
                className="sm:col-span-2 lg:col-span-3"
                control={
                  <Textarea
                    id="supplier-address"
                    name="street-address"
                    autoComplete="street-address"
                    className="min-h-20"
                    placeholder="Adresse complète"
                    value={formState.address}
                    onChange={(event) => updateField("address", event.target.value)}
                  />
                }
              />
              <ReferentielFormField
                id="supplier-postal"
                label="Code postal"
                name="postal-code"
                autoComplete="postal-code"
                placeholder="78120"
                value={formState.postal_code}
                onChange={(event) => updateField("postal_code", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-city"
                label="Ville"
                name="city"
                autoComplete="address-level2"
                placeholder="Rambouillet"
                value={formState.city}
                onChange={(event) => updateField("city", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-country"
                label="Pays"
                name="country"
                autoComplete="country-name"
                placeholder="France"
                value={formState.country}
                onChange={(event) => updateField("country", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-siret"
                label="SIRET"
                name="siret"
                autoComplete="off"
                placeholder="123 456 789 00000"
                value={formState.siret}
                onChange={(event) => updateField("siret", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-vat"
                label="TVA intracommunautaire"
                name="vat-number"
                autoComplete="off"
                placeholder="FR12345678901"
                value={formState.vat_number}
                onChange={(event) => updateField("vat_number", event.target.value)}
              />
              <ReferentielFormField
                id="supplier-payment"
                label="Conditions de paiement"
                name="payment-terms"
                autoComplete="off"
                placeholder="À 30 jours fin de mois"
                value={formState.payment_terms}
                onChange={(event) => updateField("payment_terms", event.target.value)}
              />
            </DialogBody>

            {formError ? <Alert variant="danger">{formError}</Alert> : null}

            <DialogFooter>
              <Button variant="outline" size="lg" onClick={closeForm} disabled={isSubmitting}>
                Annuler
              </Button>
              <Button type="submit" size="lg" loading={isSubmitting}>
                {editingId ? "Mettre à jour" : "Ajouter"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Filter Bar */}
      <TableFilterBar
        data={suppliers}
        onDataChange={setDisplayedSuppliers}
        search={{
          placeholder: "Rechercher par nom ou ville…",
          fields: ["name", "city"],
        }}
        sortOptions={SUPPLIERS_SORT_OPTIONS}
        resultCountLabel="fournisseurs"
        showResultCount
      />

      <PageSection
        title="Liste des fournisseurs"
        flush
        actions={
          <Button
            variant="outline"
            size="md"
            disabled={isValidating}
            onClick={() => void mutate()}
            leftIcon={
              <RotateCwIcon
                aria-hidden="true"
                className={isValidating ? "animate-spin motion-reduce:animate-none" : undefined}
              />
            }
          >
            {isValidating ? "Actualisation…" : "Actualiser"}
          </Button>
        }
      >
        {loadError ? (
          <div className="p-4">
            <Alert variant="danger">{loadError.message}</Alert>
          </div>
        ) : null}

        <div className="xl:hidden">
          {isLoading ? (
            <LoadingState label="Chargement des fournisseurs…" />
          ) : displayedSuppliers.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={emptyIcon}
              title={emptyTitle}
              description={emptyDescription}
              action={emptyAction}
            />
          ) : (
            <ul className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
              {displayedSuppliers.map((supplier) => (
                <li
                  key={supplier.id}
                  className="min-w-0 rounded-lg border border-border bg-surface p-4"
                >
                  <h3 className="break-words font-semibold text-foreground">{supplier.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[supplier.city, supplier.country].filter(Boolean).join(", ") ||
                      "Localisation non renseignée"}
                  </p>

                  <div className="mt-4 space-y-2 text-sm">
                    <p className="text-foreground-secondary">
                      <span className="font-medium text-foreground">Contact :</span>{" "}
                      {supplier.contact_name ?? "Non renseigné"}
                    </p>
                    {supplier.email ? (
                      <a
                        href={`mailto:${supplier.email}`}
                        className="block break-all text-primary hover:underline"
                      >
                        {supplier.email}
                      </a>
                    ) : (
                      <p className="text-muted-foreground">Email non renseigné</p>
                    )}
                    {supplier.phone ? (
                      <a
                        href={`tel:${supplier.phone}`}
                        className="block break-all text-primary hover:underline"
                      >
                        {supplier.phone}
                      </a>
                    ) : (
                      <p className="text-muted-foreground">Téléphone non renseigné</p>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border-subtle pt-3">
                    <Button
                      variant="outline"
                      size="md"
                      aria-label={`Modifier ${supplier.name}`}
                      onClick={() => openEditForm(supplier)}
                    >
                      Modifier
                    </Button>
                    <Button
                      variant="danger"
                      size="md"
                      aria-label={`Supprimer ${supplier.name}`}
                      onClick={() => void onDelete(supplier)}
                    >
                      Supprimer
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="relative hidden overflow-x-auto xl:block"
          role="region"
          aria-label="Liste des fournisseurs"
          tabIndex={0}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Contact</th>
                <th scope="col">Ville</th>
                <th scope="col">Email</th>
                <th scope="col">Téléphone</th>
                <th scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={TABLE_COLUMNS} className="p-0">
                    <LoadingState label="Chargement des fournisseurs…" />
                  </td>
                </tr>
              ) : displayedSuppliers.length === 0 ? (
                <EmptyTableRow
                  colSpan={TABLE_COLUMNS}
                  icon={emptyIcon}
                  title={emptyTitle}
                  description={emptyDescription}
                  action={emptyAction}
                />
              ) : (
                displayedSuppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td className="font-semibold text-foreground">{supplier.name}</td>
                    <td>{supplier.contact_name ?? "-"}</td>
                    <td>{supplier.city ?? "-"}</td>
                    <td>
                      {supplier.email ? (
                        <a
                          href={`mailto:${supplier.email}`}
                          className="text-primary hover:underline"
                        >
                          {supplier.email}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{supplier.phone ?? "-"}</td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Modifier ${supplier.name}`}
                          leftIcon={<PencilIcon aria-hidden="true" />}
                          onClick={() => openEditForm(supplier)}
                        >
                          Modifier
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={`Supprimer ${supplier.name}`}
                          leftIcon={<TrashIcon aria-hidden="true" />}
                          onClick={() => void onDelete(supplier)}
                        >
                          Supprimer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PageSection>
    </div>
  );
}
