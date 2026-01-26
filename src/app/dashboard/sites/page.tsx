"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { TableFilterBar } from "@/components/TableFilterBar";
import type { SortOption } from "@/components/TableFilterBar";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type DeliverySite = {
  id: string;
  created_at: string;
  name: string;
  project_code: string | null;
  address: string | null;
  city: string | null;
  postal_code: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  is_active: boolean;
};

// Sort options
const SITES_SORT_OPTIONS: SortOption[] = [
  { key: "name", label: "Nom", defaultDirection: "asc" },
  { key: "city", label: "Ville" },
  { key: "created_at", label: "Date d'ajout", defaultDirection: "desc" },
];

type DeliverySiteFormState = {
  name: string;
  project_code: string;
  address: string;
  city: string;
  postal_code: string;
  contact_name: string;
  contact_phone: string;
};

const EMPTY_FORM: DeliverySiteFormState = {
  name: "",
  project_code: "",
  address: "",
  city: "",
  postal_code: "",
  contact_name: "",
  contact_phone: "",
};

export default function SitesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  // Form state
  const [formState, setFormState] = useState<DeliverySiteFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const nameFieldRef = useRef<HTMLInputElement | null>(null);

  // Filtered sites state
  const [displayedSites, setDisplayedSites] = useState<DeliverySite[]>([]);

  const fetchSites = useCallback(async () => {
    const { data, error } = await supabase
      .from("delivery_sites")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []) as DeliverySite[];
  }, [supabase]);

  const {
    data: sites = [],
    error: loadError,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<DeliverySite[]>("delivery-sites", fetchSites, {
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

  const openEditForm = useCallback((site: DeliverySite) => {
    setFormError(null);
    setIsSubmitting(false);
    setEditingId(site.id);
    setFormState({
      name: site.name ?? "",
      project_code: site.project_code ?? "",
      address: site.address ?? "",
      city: site.city ?? "",
      postal_code: site.postal_code ?? "",
      contact_name: site.contact_name ?? "",
      contact_phone: site.contact_phone ?? "",
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

  useEffect(() => {
    if (!isFormOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        closeForm();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeForm, isFormOpen, isSubmitting]);

  function updateField<K extends keyof DeliverySiteFormState>(
    key: K,
    value: DeliverySiteFormState[K]
  ) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setIsSubmitting(true);

    const payload = {
      name: formState.name.trim(),
      project_code: formState.project_code.trim() || null,
      address: formState.address.trim() || null,
      city: formState.city.trim() || null,
      postal_code: formState.postal_code.trim() || null,
      contact_name: formState.contact_name.trim() || null,
      contact_phone: formState.contact_phone.trim() || null,
      is_active: true,
    };

    const { error } = editingId
      ? await supabase
          .from("delivery_sites")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("delivery_sites").insert(payload);

    setIsSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    await mutate();
    closeForm();
  }

  async function onDelete(siteId: string) {
    const { count, error: countError } = await supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_site_id", siteId);

    if (countError) {
      setFormError(countError.message);
      return;
    }

    const linkedOrdersCount = count ?? 0;
    const isPlural = linkedOrdersCount > 1;
    const confirmationMessage =
      linkedOrdersCount > 0
        ? `Attention, en supprimant ce chantier, ${linkedOrdersCount} bon${isPlural ? "s" : ""} de commande lié${isPlural ? "s" : ""} sera${isPlural ? "ont" : ""} également supprimé${isPlural ? "s" : ""}.`
        : "Supprimer ce chantier ?";

    if (!window.confirm(confirmationMessage)) {
      return;
    }

    if (linkedOrdersCount > 0) {
      const { error: linkedOrdersError } = await supabase
        .from("purchase_orders")
        .delete()
        .eq("delivery_site_id", siteId);

      if (linkedOrdersError) {
        setFormError(linkedOrdersError.message);
        return;
      }
    }

    const { error } = await supabase
      .from("delivery_sites")
      .delete()
      .eq("id", siteId);

    if (error) {
      setFormError(error.message);
      return;
    }

    await mutate();
    setFormError(null);
  }

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Chantiers</h1>
          <p className="page-description">
            Gerez les sites de livraison et leurs contacts.
          </p>
        </div>
        <button
          className="btn btn-accent btn-lg"
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
          Ajouter un chantier
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => {
              if (!isSubmitting) closeForm();
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="site-modal-title"
            className="relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--brand-orange)]/10">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--brand-orange)"
                    strokeWidth="1.75"
                  >
                    {editingId ? (
                      <>
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                      </>
                    ) : (
                      <>
                        <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                        <circle cx="12" cy="10" r="3" />
                      </>
                    )}
                  </svg>
                </div>
                <div>
                  <h2 id="site-modal-title" className="text-lg font-semibold text-[var(--slate-800)]">
                    {editingId ? "Modifier le chantier" : "Ajouter un chantier"}
                  </h2>
                  <p className="text-sm text-[var(--slate-500)]">
                    {editingId
                      ? "Mettez a jour les informations du site de livraison."
                      : "Renseignez les informations du nouveau chantier."}
                  </p>
                </div>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={closeForm}
                disabled={isSubmitting}
              >
                Fermer
              </button>
            </div>

            <form className="grid gap-5 overflow-y-auto p-6 sm:grid-cols-2 lg:grid-cols-3" onSubmit={onSubmit}>
              <div className="sm:col-span-2">
                <label className="form-label" htmlFor="site-name">Nom du chantier *</label>
                <input
                  ref={nameFieldRef}
                  id="site-name"
                  name="site-name"
                  autoComplete="off"
                  className="form-input"
                  placeholder="Nom du chantier"
                  required
                  value={formState.name}
                  onChange={(event) => updateField("name", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="site-project-code">Code projet</label>
                <input
                  id="site-project-code"
                  name="project-code"
                  autoComplete="off"
                  className="form-input"
                  placeholder="RESPINS"
                  value={formState.project_code}
                  onChange={(event) => updateField("project_code", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="site-contact">Contact sur site</label>
                <input
                  id="site-contact"
                  name="contact-name"
                  autoComplete="name"
                  className="form-input"
                  placeholder="Nom du contact"
                  value={formState.contact_name}
                  onChange={(event) => updateField("contact_name", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="site-phone">Telephone contact</label>
                <input
                  id="site-phone"
                  name="contact-phone"
                  type="tel"
                  autoComplete="tel"
                  className="form-input"
                  placeholder="06 00 00 00 00"
                  value={formState.contact_phone}
                  onChange={(event) => updateField("contact_phone", event.target.value)}
                />
              </div>

              <div className="lg:row-start-2">
                <label className="form-label" htmlFor="site-postal">Code postal</label>
                <input
                  id="site-postal"
                  name="postal-code"
                  autoComplete="postal-code"
                  className="form-input"
                  placeholder="78120"
                  value={formState.postal_code}
                  onChange={(event) => updateField("postal_code", event.target.value)}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label className="form-label" htmlFor="site-address">Adresse</label>
                <textarea
                  id="site-address"
                  name="street-address"
                  autoComplete="street-address"
                  className="form-input form-textarea"
                  placeholder="Adresse du chantier"
                  value={formState.address}
                  onChange={(event) => updateField("address", event.target.value)}
                />
              </div>

              <div>
                <label className="form-label" htmlFor="site-city">Ville</label>
                <input
                  id="site-city"
                  name="city"
                  autoComplete="address-level2"
                  className="form-input"
                  placeholder="Rambouillet"
                  value={formState.city}
                  onChange={(event) => updateField("city", event.target.value)}
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center justify-between gap-4 pt-2">
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
                <div className="flex items-center gap-3">
                  <button
                    className="btn btn-secondary"
                    onClick={closeForm}
                    type="button"
                    disabled={isSubmitting}
                  >
                    Annuler
                  </button>
                  <button
                    className="btn btn-accent"
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
            </form>
          </div>
        </div>
      ) : null}

      {/* Filter Bar */}
      <TableFilterBar
        data={sites}
        onDataChange={setDisplayedSites}
        search={{
          placeholder: "Rechercher par nom, code projet ou ville...",
          fields: ["name", "project_code", "city"],
        }}
        sortOptions={SITES_SORT_OPTIONS}
        resultCountLabel="chantiers"
        showResultCount
      />

      {/* Table card */}
      <div className="dashboard-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--slate-200)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Liste des chantiers
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

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Code projet</th>
                <th>Ville</th>
                <th>Contact</th>
                <th>Telephone</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayedSites.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12">
                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-orange)]"></div>
                        <span className="text-[var(--slate-500)]">Chargement...</span>
                      </div>
                    ) : sites.length === 0 ? (
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
                            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                        </div>
                        <div className="text-center">
                          <p className="font-medium text-[var(--slate-700)]">Aucun chantier</p>
                          <p className="mt-1 text-sm text-[var(--slate-500)]">Cliquez sur le bouton Ajouter un chantier pour demarrer.</p>
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
                displayedSites.map((site, index) => (
                  <tr
                    key={site.id}
                    className="animate-fade-in"
                    style={{ animationDelay: `${index * 0.03}s` }}
                  >
                    <td className="font-semibold text-[var(--slate-800)]">{site.name}</td>
                    <td>
                      {site.project_code ? (
                        <span className="inline-flex items-center rounded-md bg-[var(--brand-orange)]/10 px-2 py-1 text-xs font-semibold text-[var(--brand-orange)]">
                          {site.project_code}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{site.city ?? "-"}</td>
                    <td>{site.contact_name ?? "-"}</td>
                    <td>
                      {site.contact_phone ? (
                        <a
                          href={`tel:${site.contact_phone}`}
                          className="text-[var(--brand-blue)] hover:underline"
                        >
                          {site.contact_phone}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEditForm(site)}
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
                          onClick={() => onDelete(site.id)}
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
