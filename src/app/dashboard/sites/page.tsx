"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { MapPinIcon, PencilIcon, PlusIcon, RotateCwIcon, SearchIcon, TrashIcon } from "lucide-react";

import { ReferentielFormField } from "@/components/catalogue/ReferentielFormField";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { EmptyState, EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import { TableFilterBar } from "@/components/TableFilterBar";
import type { SortOption } from "@/components/TableFilterBar";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

const TABLE_COLUMNS = 6;

export default function SitesPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const confirm = useConfirm();

  // Form state
  const [formState, setFormState] = useState<DeliverySiteFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
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

  async function onDelete(site: DeliverySite) {
    setPageError(null);
    const { count, error: countError } = await supabase
      .from("purchase_orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_site_id", site.id);

    if (countError) {
      setPageError(countError.message);
      return;
    }

    const linkedOrdersCount = count ?? 0;
    const isPlural = linkedOrdersCount > 1;
    const confirmed = await confirm({
      title: `Supprimer le chantier « ${site.name} » ?`,
      description:
        linkedOrdersCount > 0
          ? `Attention : ${linkedOrdersCount} bon${isPlural ? "s" : ""} de commande lié${isPlural ? "s" : ""} ser${isPlural ? "ont" : "a"} également supprimé${isPlural ? "s" : ""}. Cette suppression est définitive.`
          : "Ce chantier n’est lié à aucun bon de commande. Cette suppression est définitive.",
      confirmLabel: linkedOrdersCount > 0 ? "Supprimer le chantier et ses bons" : "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    if (linkedOrdersCount > 0) {
      const { error: linkedOrdersError } = await supabase
        .from("purchase_orders")
        .delete()
        .eq("delivery_site_id", site.id);

      if (linkedOrdersError) {
        setPageError(linkedOrdersError.message);
        return;
      }
    }

    const { error } = await supabase
      .from("delivery_sites")
      .delete()
      .eq("id", site.id);

    if (error) {
      setPageError(error.message);
      return;
    }

    await mutate();
  }

  const emptyTitle = sites.length === 0 ? "Aucun chantier" : "Aucun résultat";
  const emptyDescription =
    sites.length === 0
      ? "Ajoutez un chantier pour démarrer."
      : "Modifiez vos filtres pour voir plus de résultats.";
  const emptyIcon = sites.length === 0 ? <MapPinIcon /> : <SearchIcon />;
  const emptyAction =
    sites.length === 0 ? (
      <Button variant="accent" leftIcon={<PlusIcon aria-hidden="true" />} onClick={openCreateForm}>
        Ajouter un chantier
      </Button>
    ) : null;

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Référentiel", href: "/dashboard/referentiel" },
          { label: "Chantiers" },
        ]}
        title="Chantiers"
        description="Gérez les sites de livraison et leurs contacts."
        actions={
          <Button
            variant="accent"
            size="lg"
            className="w-full sm:w-auto"
            leftIcon={<PlusIcon aria-hidden="true" />}
            onClick={openCreateForm}
          >
            Ajouter un chantier
          </Button>
        }
      />

      {pageError ? (
        <Alert variant="danger" className="mb-6">
          {pageError}
        </Alert>
      ) : null}

      <Dialog
        disablePointerDismissal
        open={isFormOpen}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) closeForm();
        }}
      >
        <DialogContent size="xl" initialFocus={nameFieldRef}>
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifier le chantier" : "Ajouter un chantier"}</DialogTitle>
            <DialogDescription>
              {editingId
                ? "Mettez à jour les informations du site de livraison."
                : "Renseignez les informations du nouveau chantier. Seul le nom est obligatoire."}
            </DialogDescription>
          </DialogHeader>

          <form className="flex min-h-0 flex-col gap-4" onSubmit={onSubmit}>
            <DialogBody className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <ReferentielFormField
                ref={nameFieldRef}
                id="site-name"
                label="Nom du chantier *"
                className="sm:col-span-2"
                name="site-name"
                autoComplete="off"
                placeholder="Nom du chantier"
                required
                value={formState.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
              <ReferentielFormField
                id="site-project-code"
                label="Code projet"
                name="project-code"
                autoComplete="off"
                placeholder="RESPINS"
                value={formState.project_code}
                onChange={(event) => updateField("project_code", event.target.value)}
              />
              <ReferentielFormField
                id="site-contact"
                label="Contact sur site"
                name="contact-name"
                autoComplete="name"
                placeholder="Nom du contact"
                value={formState.contact_name}
                onChange={(event) => updateField("contact_name", event.target.value)}
              />
              <ReferentielFormField
                id="site-phone"
                label="Téléphone du contact"
                name="contact-phone"
                type="tel"
                autoComplete="tel"
                placeholder="06 00 00 00 00"
                value={formState.contact_phone}
                onChange={(event) => updateField("contact_phone", event.target.value)}
              />
              <ReferentielFormField
                id="site-address"
                label="Adresse"
                className="sm:col-span-2 lg:col-span-3"
                control={
                  <Textarea
                    id="site-address"
                    name="street-address"
                    autoComplete="street-address"
                    className="min-h-20"
                    placeholder="Adresse du chantier"
                    value={formState.address}
                    onChange={(event) => updateField("address", event.target.value)}
                  />
                }
              />
              <ReferentielFormField
                id="site-postal"
                label="Code postal"
                name="postal-code"
                autoComplete="postal-code"
                placeholder="78120"
                value={formState.postal_code}
                onChange={(event) => updateField("postal_code", event.target.value)}
              />
              <ReferentielFormField
                id="site-city"
                label="Ville"
                name="city"
                autoComplete="address-level2"
                placeholder="Rambouillet"
                value={formState.city}
                onChange={(event) => updateField("city", event.target.value)}
              />
            </DialogBody>

            {formError ? <Alert variant="danger">{formError}</Alert> : null}

            <DialogFooter>
              <Button variant="outline" size="lg" onClick={closeForm} disabled={isSubmitting}>
                Annuler
              </Button>
              <Button type="submit" variant="accent" size="lg" loading={isSubmitting}>
                {editingId ? "Mettre à jour" : "Ajouter"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Filter Bar */}
      <TableFilterBar
        data={sites}
        onDataChange={setDisplayedSites}
        search={{
          placeholder: "Rechercher par nom, code projet ou ville…",
          fields: ["name", "project_code", "city"],
        }}
        sortOptions={SITES_SORT_OPTIONS}
        resultCountLabel="chantiers"
        showResultCount
      />

      <PageSection
        title="Liste des chantiers"
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
            <LoadingState label="Chargement des chantiers…" />
          ) : displayedSites.length === 0 ? (
            <EmptyState
              variant="plain"
              icon={emptyIcon}
              title={emptyTitle}
              description={emptyDescription}
              action={emptyAction}
            />
          ) : (
            <ul className="grid gap-3 p-3 sm:p-4 lg:grid-cols-2">
              {displayedSites.map((site) => (
                <li key={site.id} className="min-w-0 rounded-lg border border-border bg-surface p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold text-foreground">{site.name}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {site.city ?? "Ville non renseignée"}
                      </p>
                    </div>
                    {site.project_code ? (
                      <Badge variant="accent" className="max-w-[45%]">
                        <span className="truncate">{site.project_code}</span>
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-4 space-y-2 text-sm">
                    <p className="text-foreground-secondary">
                      <span className="font-medium text-foreground">Contact :</span>{" "}
                      {site.contact_name ?? "Non renseigné"}
                    </p>
                    {site.contact_phone ? (
                      <a
                        href={`tel:${site.contact_phone}`}
                        className="block break-all text-primary hover:underline"
                      >
                        {site.contact_phone}
                      </a>
                    ) : (
                      <p className="text-muted-foreground">Téléphone non renseigné</p>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border-subtle pt-3">
                    <Button
                      variant="outline"
                      size="md"
                      aria-label={`Modifier ${site.name}`}
                      onClick={() => openEditForm(site)}
                    >
                      Modifier
                    </Button>
                    <Button
                      variant="danger"
                      size="md"
                      aria-label={`Supprimer ${site.name}`}
                      onClick={() => void onDelete(site)}
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
          aria-label="Liste des chantiers"
          tabIndex={0}
        >
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Nom</th>
                <th scope="col">Code projet</th>
                <th scope="col">Ville</th>
                <th scope="col">Contact</th>
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
                    <LoadingState label="Chargement des chantiers…" />
                  </td>
                </tr>
              ) : displayedSites.length === 0 ? (
                <EmptyTableRow
                  colSpan={TABLE_COLUMNS}
                  icon={emptyIcon}
                  title={emptyTitle}
                  description={emptyDescription}
                  action={emptyAction}
                />
              ) : (
                displayedSites.map((site) => (
                  <tr key={site.id}>
                    <td className="font-semibold text-foreground">{site.name}</td>
                    <td>
                      {site.project_code ? (
                        <Badge variant="accent">{site.project_code}</Badge>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{site.city ?? "-"}</td>
                    <td>{site.contact_name ?? "-"}</td>
                    <td>
                      {site.contact_phone ? (
                        <a href={`tel:${site.contact_phone}`} className="text-primary hover:underline">
                          {site.contact_phone}
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Modifier ${site.name}`}
                          leftIcon={<PencilIcon aria-hidden="true" />}
                          onClick={() => openEditForm(site)}
                        >
                          Modifier
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={`Supprimer ${site.name}`}
                          leftIcon={<TrashIcon aria-hidden="true" />}
                          onClick={() => void onDelete(site)}
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
