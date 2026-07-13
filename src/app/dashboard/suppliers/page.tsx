"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { HubBreadcrumb } from "@/components/HubBreadcrumb";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { SortOption } from "@/components/TableFilterBar";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

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

export default function SuppliersPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Form state
  const [formState, setFormState] = useState<SupplierFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const nameFieldRef = useRef<HTMLInputElement | null>(null);

  // Filtered suppliers state
  const [displayedSuppliers, setDisplayedSuppliers] = useState<Supplier[]>([]);

  const fetchSuppliers = useCallback(async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as Supplier[];
  }, [supabase]);

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

  useEffect(() => {
    if (!isFormOpen) return;
    const timeout = window.setTimeout(() => {
      nameFieldRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [isFormOpen]);

  useEffect(() => {
    if (!isFormOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isFormOpen]);

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

    const { error } = editingId
      ? await supabase.from("suppliers").update(payload).eq("id", editingId)
      : await supabase.from("suppliers").insert(payload);

    setIsSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    await mutate();
    closeForm();
  }

  async function onDelete(supplierId: string) {
    async function archiveSupplier() {
      const { error: archiveError } = await supabase
        .from("suppliers")
        .update({ is_active: false })
        .eq("id", supplierId);

      if (archiveError) {
        setFormError(archiveError.message);
        return;
      }

      await mutate();
      setFormError(null);
    }

    const { count, error: countError } = await supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("supplier_id", supplierId);

    if (countError) {
      setFormError(countError.message);
      return;
    }

    const linkedOrdersCount = count ?? 0;
    const hasLinkedOrders = linkedOrdersCount > 0;
    const isPlural = linkedOrdersCount > 1;
    const confirmationMessage = hasLinkedOrders
      ? `Ce fournisseur est utilise dans ${linkedOrdersCount} bon${isPlural ? "s" : ""} de commande. Il sera archive et retire de la liste active. Continuer ?`
      : "Supprimer ce fournisseur ?";

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    if (hasLinkedOrders) {
      await archiveSupplier();
      return;
    }

    const { error } = await supabase
      .from("suppliers")
      .delete()
      .eq("id", supplierId);

    if (error) {
      if (error.code === "23503") {
        await archiveSupplier();
        return;
      }

      setFormError(error.message);
      return;
    }

    await mutate();
    setFormError(null);
  }

  return (
    <div className="animate-fade-in">
      <HubBreadcrumb hubHref="/dashboard/referentiel" hubLabel="Référentiel" currentLabel="Fournisseurs" />
      {/* Page header */}
      <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div>
          <h1 className="page-title">Fournisseurs</h1>
          <p className="page-description">
            Gérez la liste des fournisseurs Hydro Express.
          </p>
        </div>
        <button
          className="btn btn-primary btn-lg w-full justify-center sm:w-auto"
          type="button"
          onClick={openCreateForm}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14" />
            <path d="M12 5v14" />
          </svg>
          Ajouter un fournisseur
        </button>
      </div>

      {!isFormOpen && formError ? (
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {formError}
        </div>
      ) : null}

      {isFormOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="supplier-modal-title"
            className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-[var(--slate-200)] px-4 py-4 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-blue)]/10">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--brand-blue)"
                    strokeWidth="1.75"
                  >
                    {editingId ? (
                      <>
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </>
                    ) : (
                      <>
                        <path d="M5 12h14" />
                        <path d="M12 5v14" />
                      </>
                    )}
                  </svg>
                </div>
                <div>
                  <h2 id="supplier-modal-title" className="text-lg font-semibold text-[var(--slate-800)]">
                    {editingId ? "Modifier le fournisseur" : "Ajouter un fournisseur"}
                  </h2>
                  <p className="text-sm text-[var(--slate-500)]">
                    {editingId
                      ? "Mettez a jour les informations du fournisseur."
                      : "Renseignez les informations du nouveau fournisseur."}
                  </p>
                </div>
              </div>
            </div>

            <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
              <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="form-label" htmlFor="supplier-name">Nom *</label>
                <input
                  ref={nameFieldRef}
                  id="supplier-name"
                  name="organization"
                  autoComplete="organization"
                  className="form-input"
                  placeholder="Nom de l'entreprise"
                  required
                  value={formState.name}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-contact">Contact</label>
                <input
                  id="supplier-contact"
                  name="contact-name"
                  autoComplete="name"
                  className="form-input"
                  placeholder="Nom du contact"
                  value={formState.contact_name}
                  onChange={(event) => updateField("contact_name", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-phone">Téléphone</label>
                <input
                  id="supplier-phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  className="form-input"
                  placeholder="01 00 00 00 00"
                  value={formState.phone}
                  onChange={(event) => updateField("phone", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-email">Email</label>
                <input
                  id="supplier-email"
                  name="email"
                  className="form-input"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="contact@fournisseur.fr"
                  type="email"
                  value={formState.email}
                  onChange={(event) => updateField("email", event.target.value)}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label className="form-label" htmlFor="supplier-address">Adresse</label>
                <textarea
                  id="supplier-address"
                  name="street-address"
                  autoComplete="street-address"
                  className="form-input form-textarea"
                  placeholder="Adresse complete"
                  value={formState.address}
                  onChange={(event) => updateField("address", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-postal">Code postal</label>
                <input
                  id="supplier-postal"
                  name="postal-code"
                  autoComplete="postal-code"
                  className="form-input"
                  placeholder="78120"
                  value={formState.postal_code}
                  onChange={(event) => updateField("postal_code", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-city">Ville</label>
                <input
                  id="supplier-city"
                  name="city"
                  autoComplete="address-level2"
                  className="form-input"
                  placeholder="Rambouillet"
                  value={formState.city}
                  onChange={(event) => updateField("city", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-country">Pays</label>
                <input
                  id="supplier-country"
                  name="country"
                  autoComplete="country-name"
                  className="form-input"
                  placeholder="France"
                  value={formState.country}
                  onChange={(event) => updateField("country", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-siret">SIRET</label>
                <input
                  id="supplier-siret"
                  name="siret"
                  autoComplete="off"
                  className="form-input"
                  placeholder="123 456 789 00000"
                  value={formState.siret}
                  onChange={(event) => updateField("siret", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-vat">TVA intracommunautaire</label>
                <input
                  id="supplier-vat"
                  name="vat-number"
                  autoComplete="off"
                  className="form-input"
                  placeholder="FR12345678901"
                  value={formState.vat_number}
                  onChange={(event) => updateField("vat_number", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="supplier-payment">Conditions de paiement</label>
                <input
                  id="supplier-payment"
                  name="payment-terms"
                  autoComplete="off"
                  className="form-input"
                  placeholder="A 30 jours fin de mois"
                  value={formState.payment_terms}
                  onChange={(event) => updateField("payment_terms", event.target.value)}
                />
              </div>

              </div>

              <div className="shrink-0 border-t border-[var(--slate-200)] bg-surface px-4 py-3 sm:px-6 sm:py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {formError ? (
                  <div className="alert alert-error flex-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="m15 9-6 6" />
                      <path d="m9 9 6 6" />
                    </svg>
                    {formError}
                  </div>
                ) : (
                  <span />
                )}
                <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
                  <button
                    className="btn btn-secondary w-full justify-center sm:w-auto"
                    onClick={closeForm}
                    type="button"
                    disabled={isSubmitting}
                  >
                    Annuler
                  </button>
                  <button
                    className="btn btn-primary w-full justify-center sm:w-auto"
                    disabled={isSubmitting}
                    type="submit"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white"></div>
                        Enregistrement...
                      </>
                    ) : editingId ? (
                      "Mettre a jour"
                    ) : (
                      "Ajouter"
                    )}
                  </button>
                </div>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Filter Bar */}
      <TableFilterBar
        data={suppliers}
        onDataChange={setDisplayedSuppliers}
        search={{
          placeholder: "Rechercher par nom ou ville...",
          fields: ["name", "city"],
        }}
        sortOptions={SUPPLIERS_SORT_OPTIONS}
        resultCountLabel="fournisseurs"
        showResultCount
      />

      {/* Table card */}
      <div className="dashboard-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--slate-200)] px-4 py-4 sm:px-6">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Liste des fournisseurs
          </h2>
          <button
            className="btn btn-secondary btn-sm"
            disabled={isValidating}
            onClick={() => void mutate()}
            type="button"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={isValidating ? "animate-spin" : ""}
            >
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
            {isValidating ? "Chargement..." : "Actualiser"}
          </button>
        </div>

        {loadError ? (
          <div className="alert alert-error m-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m15 9-6 6" />
              <path d="m9 9 6 6" />
            </svg>
            {loadError.message}
          </div>
        ) : null}

        <div className="xl:hidden">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-sm text-[var(--slate-500)]">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]" />
              Chargement...
            </div>
          ) : displayedSuppliers.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="font-medium text-[var(--slate-700)]">
                {suppliers.length === 0 ? "Aucun fournisseur" : "Aucun resultat"}
              </p>
              <p className="mt-1 text-sm text-[var(--slate-500)]">
                {suppliers.length === 0
                  ? "Ajoutez un fournisseur pour demarrer."
                  : "Modifiez vos filtres pour voir plus de resultats."}
              </p>
            </div>
          ) : (
            <div className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
              {displayedSuppliers.map((supplier, index) => (
                <article
                  key={supplier.id}
                  className="min-w-0 animate-fade-in rounded-xl border border-[var(--slate-200)] bg-white p-4"
                  style={{ animationDelay: `${index * 0.03}s` }}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-[var(--slate-800)]">
                        {supplier.name}
                      </h3>
                      <p className="mt-1 text-sm text-[var(--slate-500)]">
                        {[supplier.city, supplier.country].filter(Boolean).join(", ") || "Localisation non renseignee"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 text-sm">
                    <p className="text-[var(--slate-600)]">
                      <span className="font-medium text-[var(--slate-800)]">Contact :</span>{" "}
                      {supplier.contact_name ?? "Non renseigne"}
                    </p>
                    {supplier.email ? (
                      <a
                        href={`mailto:${supplier.email}`}
                        className="block break-all text-[var(--brand-blue)] hover:underline"
                      >
                        {supplier.email}
                      </a>
                    ) : (
                      <p className="text-[var(--slate-400)]">Email non renseigne</p>
                    )}
                    {supplier.phone ? (
                      <a
                        href={`tel:${supplier.phone}`}
                        className="block break-all text-[var(--brand-blue)] hover:underline"
                      >
                        {supplier.phone}
                      </a>
                    ) : (
                      <p className="text-[var(--slate-400)]">Téléphone non renseigné</p>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--slate-100)] pt-3">
                    <button
                      className="btn btn-secondary btn-sm w-full justify-center"
                      onClick={() => openEditForm(supplier)}
                      type="button"
                    >
                      Modifier
                    </button>
                    <button
                      className="btn btn-danger btn-sm w-full justify-center"
                      onClick={() => onDelete(supplier.id)}
                      type="button"
                    >
                      Supprimer
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="hidden overflow-x-auto xl:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Contact</th>
                <th>Ville</th>
                <th>Email</th>
                <th>Téléphone</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedSuppliers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
                        <span className="text-[var(--slate-500)]">Chargement...</span>
                      </div>
                    ) : suppliers.length === 0 ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--slate-400)"
                            strokeWidth="1.5"
                          >
                            <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                            <rect width="20" height="14" x="2" y="6" rx="2" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun fournisseur</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">Cliquez sur le bouton Ajouter un fournisseur pour démarrer.</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--slate-100)]">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--slate-400)"
                            strokeWidth="1.5"
                          >
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.3-4.3" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun resultat</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">Modifiez vos filtres pour voir plus de resultats.</p>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                displayedSuppliers.map((supplier, index) => (
                  <tr
                    key={supplier.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 0.03}s` }}
                  >
                    <td className="font-semibold text-[var(--slate-800)]">
                      {supplier.name}
                    </td>
                    <td>{supplier.contact_name ?? "-"}</td>
                    <td>{supplier.city ?? "-"}</td>
                    <td>
                      {supplier.email ? (
                        <a
                          href={`mailto:${supplier.email}`}
                          className="text-[var(--brand-blue)] hover:underline"
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
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEditForm(supplier)}
                          type="button"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                          </svg>
                          Modifier
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => onDelete(supplier.id)}
                          type="button"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M3 6h18" />
                            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
