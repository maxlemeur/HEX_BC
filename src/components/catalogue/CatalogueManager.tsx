"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { ChevronDownIcon, PackageIcon, PencilIcon, SearchIcon, TrashIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import type { CatalogueItem } from "@/components/catalogue/types";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageSection } from "@/components/layout/page-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input, controlSizes, controlSurface } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NumberInput, parseLocalizedNumberInput } from "@/components/ui-legacy/NumberInput";
import { formatEUR, parseEuroToCents } from "@/lib/money";
import { cn } from "@/lib/utils";

type CatalogueListResponse = {
  items: CatalogueItem[];
};

type ImportListItem = {
  id: string;
  filename: string;
  status: string;
  row_count: number;
  created_at: string;
};

type LinkMappedRowsResponse = {
  import_id: string;
  scanned_rows: number;
  linked_count: number;
  created_catalogue_count: number;
  unmatched_count: number;
  dry_run: boolean;
  links?: Array<{
    mapped_row_id: string;
    product_id: string;
    match_type: string;
  }>;
};

type CatalogueFormState = {
  reference: string;
  designation: string;
  unit_price_euros: string;
  tax_rate_bp: string;
  is_active: boolean;
};

const EMPTY_FORM: CatalogueFormState = {
  reference: "",
  designation: "",
  unit_price_euros: "0,00",
  tax_rate_bp: "2000",
  is_active: true,
};

function toEuroInput(unitPriceCents: number | undefined | null) {
  if (typeof unitPriceCents !== "number") return "";
  return (unitPriceCents / 100).toFixed(2).replace(".", ",");
}

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

// M-20: Display TVA as percentage
function formatTaxRate(bp: number | undefined | null): string {
  if (typeof bp !== "number" || !Number.isFinite(bp)) return "-";
  return `${(bp / 100).toFixed(bp % 100 === 0 ? 0 : 1)} %`;
}

// M-17: Tab state for catalogue sections
type CatalogueTab = "catalogue" | "liaison";

const CATALOGUE_COLUMNS = 6;

export function CatalogueManager() {
  // M-16: Accept ?import_id= query param
  const searchParams = useSearchParams();
  const importIdFromUrl = searchParams.get("import_id");
  const confirm = useConfirm();

  const [activeTab, setActiveTab] = useState<CatalogueTab>(
    importIdFromUrl ? "liaison" : "catalogue"
  );
  const [items, setItems] = useState<CatalogueItem[]>([]);
  const [availableImports, setAvailableImports] = useState<ImportListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [formState, setFormState] = useState<CatalogueFormState>(EMPTY_FORM);
  // M-16: Replace UUID input with dropdown
  const [linkImportId, setLinkImportId] = useState(importIdFromUrl ?? "");
  const [linkLimit, setLinkLimit] = useState(1000);
  const [linkCreateMissing, setLinkCreateMissing] = useState(true);
  const [linkUpdatePayload, setLinkUpdatePayload] = useState(true);
  const [linkDryRun, setLinkDryRun] = useState(false);
  const [linkSummary, setLinkSummary] = useState<LinkMappedRowsResponse | null>(null);
  // M-21: Advanced options toggle
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const search = searchTerm.trim();
      const query = new URLSearchParams();
      query.set("limit", "300");
      if (search.length > 0) {
        query.set("search", search);
      }

      const data = await fetchApi<CatalogueListResponse>(`/api/catalogue?${query.toString()}`);
      setItems(data.items ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Impossible de charger le catalogue."
      );
    } finally {
      setIsLoading(false);
    }
  }, [searchTerm]);

  // M-16: Load available imports for dropdown
  const loadImports = useCallback(async () => {
    try {
      const response = await fetch("/api/imports", {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) return;

      const payload = await response.json();
      const list = Array.isArray(payload) ? payload : (payload?.data ?? []);
      const normalized: ImportListItem[] = list.map((item: Record<string, unknown>) => ({
        id: String(item.id ?? ""),
        filename: String(item.filename ?? item.file_name ?? item.fileName ?? ""),
        status: String(item.status ?? ""),
        row_count: Number(item.row_count ?? item.rows_count ?? 0),
        created_at: String(item.created_at ?? ""),
      }));
      setAvailableImports(normalized);
    } catch {
      // Non-blocking: imports list is optional
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadImports();
  }, [loadImports]);

  const editingItem = useMemo(
    () => items.find((item) => item.id === editingId) ?? null,
    [items, editingId]
  );

  function resetForm() {
    setEditingId(null);
    setFormState(EMPTY_FORM);
  }

  function onEdit(item: CatalogueItem) {
    setError(null);
    setSuccess(null);
    setEditingId(item.id);
    document.getElementById("catalogue-reference")?.focus();
    setFormState({
      reference: item.reference ?? item.hex_code ?? "",
      designation: item.designation ?? "",
      unit_price_euros: toEuroInput(item.unit_price_cents),
      tax_rate_bp:
        typeof item.tax_rate_bp === "number" && Number.isFinite(item.tax_rate_bp)
          ? String(item.tax_rate_bp)
          : "2000",
      is_active: item.is_active ?? true,
    });
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const unitPriceCents = parseEuroToCents(formState.unit_price_euros);
    if (unitPriceCents === null || unitPriceCents < 0) {
      setError("Prix unitaire invalide.");
      return;
    }

    const taxRateBp = Number.parseInt(formState.tax_rate_bp, 10);
    if (!Number.isFinite(taxRateBp) || taxRateBp < 0 || taxRateBp > 10000) {
      setError("Taux TVA invalide.");
      return;
    }

    if (!formState.reference.trim() || !formState.designation.trim()) {
      setError("Référence et désignation sont requises.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingId) {
        await fetchApi<{ item: CatalogueItem }>("/api/catalogue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update",
            id: editingId,
            item: {
              reference: formState.reference.trim(),
              designation: formState.designation.trim(),
              unit_price_cents: unitPriceCents,
              tax_rate_bp: taxRateBp,
              is_active: formState.is_active,
            },
          }),
        });

        setSuccess("Ligne catalogue mise à jour.");
      } else {
        await fetchApi<{ item: CatalogueItem }>("/api/catalogue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create",
            item: {
              reference: formState.reference.trim(),
              designation: formState.designation.trim(),
              unit_price_cents: unitPriceCents,
              tax_rate_bp: taxRateBp,
              is_active: formState.is_active,
            },
          }),
        });

        setSuccess("Ligne catalogue créée.");
      }

      resetForm();
      await loadItems();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Impossible d'enregistrer la ligne catalogue."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete(item: CatalogueItem) {
    const confirmed = await confirm({
      title: `Supprimer l’article « ${item.designation} » ?`,
      description: "L’article sera retiré du catalogue. Cette suppression est définitive.",
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    setError(null);
    setSuccess(null);

    try {
      await fetchApi<{ deleted_id: string }>("/api/catalogue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          id: item.id,
        }),
      });

      if (editingId === item.id) {
        resetForm();
      }

      setSuccess("Ligne catalogue supprimée.");
      await loadItems();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer la ligne catalogue."
      );
    }
  }

  async function onRunLinking() {
    if (!linkImportId.trim()) {
      setError("Sélectionnez un import pour lancer la liaison.");
      return;
    }

    setIsLinking(true);
    setError(null);
    setSuccess(null);
    setLinkSummary(null);

    try {
      const summary = await fetchApi<LinkMappedRowsResponse>("/api/catalogue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "link-mapped-rows",
          import_id: linkImportId.trim(),
          limit: linkLimit,
          create_missing: linkCreateMissing,
          update_payload: linkUpdatePayload,
          dry_run: linkDryRun,
        }),
      });

      setLinkSummary(summary);
      setSuccess(linkDryRun ? "Simulation de liaison terminée." : "Liaison terminée.");
      await loadItems();
    } catch (linkError) {
      setError(
        linkError instanceof Error ? linkError.message : "Impossible de lier les lignes mappées."
      );
    } finally {
      setIsLinking(false);
    }
  }

  const linkRate =
    linkSummary && linkSummary.scanned_rows > 0
      ? Math.round((linkSummary.linked_count / linkSummary.scanned_rows) * 100)
      : null;

  return (
    <div className="space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {success && !linkSummary ? <Alert variant="success">{success}</Alert> : null}

      {/* M-17: Tabs separate the catalogue CRUD from the liaison */}
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CatalogueTab)}>
        <TabsList className="h-auto w-full">
          <TabsTrigger value="catalogue" className="min-h-9 px-3">
            Catalogue articles
          </TabsTrigger>
          <TabsTrigger value="liaison" className="min-h-9 px-3">
            Liaison lignes importées
          </TabsTrigger>
        </TabsList>

        {/* ===== CATALOGUE TAB ===== */}
        <TabsContent value="catalogue" className="mt-4 space-y-6">
          <PageSection
            title="Catalogue articles"
            description="Gérez les produits du catalogue (référence, désignation, prix unitaire)."
            flush
            actions={
              <form
                role="search"
                className="flex w-full min-w-0 items-center gap-2 sm:w-auto"
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearchTerm(searchInput.trim());
                }}
              >
                <Input
                  type="search"
                  size="sm"
                  aria-label="Rechercher un article par référence ou désignation"
                  className="sm:w-64"
                  placeholder="Référence ou désignation…"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  size="md"
                  leftIcon={<SearchIcon aria-hidden="true" />}
                >
                  Rechercher
                </Button>
              </form>
            }
          >
            <div
              className="table-scroll relative overflow-x-auto"
              role="region"
              aria-label="Articles du catalogue"
              tabIndex={0}
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Référence</th>
                    <th scope="col">Désignation</th>
                    <th scope="col" className="text-right">Prix HT</th>
                    {/* M-20: Display TVA as % */}
                    <th scope="col" className="text-right">TVA</th>
                    <th scope="col">Mise à jour</th>
                    <th scope="col" className="text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr>
                      <td colSpan={CATALOGUE_COLUMNS} className="p-0">
                        <LoadingState label="Chargement du catalogue…" className="py-8" />
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <EmptyTableRow
                      colSpan={CATALOGUE_COLUMNS}
                      variant="compact"
                      icon={<PackageIcon />}
                      title={searchTerm ? "Aucun article ne correspond à la recherche" : "Aucun article catalogue"}
                      description={
                        searchTerm
                          ? "Modifiez la recherche pour voir plus de résultats."
                          : "Ajoutez un article avec le formulaire ci-dessous ou liez les lignes d’un import."
                      }
                    />
                  ) : (
                    items.map((item) => {
                      const itemLabel = item.reference ?? item.hex_code ?? item.designation;
                      return (
                        <tr key={item.id}>
                          <td className="font-medium text-foreground">
                            {item.reference ?? item.hex_code ?? "-"}
                          </td>
                          <td>{item.designation || "-"}</td>
                          <td className="text-right font-mono">
                            {typeof item.unit_price_cents === "number"
                              ? formatEUR(item.unit_price_cents)
                              : "-"}
                          </td>
                          {/* M-20: TVA in percentage */}
                          <td className="text-right">{formatTaxRate(item.tax_rate_bp)}</td>
                          <td className="whitespace-nowrap text-muted-foreground">
                            {formatDateTime(item.updated_at ?? item.created_at)}
                          </td>
                          <td>
                            <div className="flex items-center justify-end gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                aria-label={`Modifier l’article ${itemLabel}`}
                                leftIcon={<PencilIcon aria-hidden="true" />}
                                onClick={() => onEdit(item)}
                              >
                                Modifier
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                aria-label={`Supprimer l’article ${itemLabel}`}
                                leftIcon={<TrashIcon aria-hidden="true" />}
                                onClick={() => void onDelete(item)}
                              >
                                Supprimer
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </PageSection>

          <PageSection
            id="catalogue-form-title"
            title={editingItem ? "Modifier un article" : "Ajouter un article"}
          >
            <form className="grid gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
              <div className="flex min-w-0 flex-col gap-2">
                <FieldLabel htmlFor="catalogue-reference">Référence *</FieldLabel>
                <Input
                  id="catalogue-reference"
                  autoComplete="off"
                  value={formState.reference}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, reference: event.target.value }))
                  }
                  required
                />
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <FieldLabel htmlFor="catalogue-designation">Désignation *</FieldLabel>
                <Input
                  id="catalogue-designation"
                  value={formState.designation}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, designation: event.target.value }))
                  }
                  required
                />
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <FieldLabel htmlFor="catalogue-unit-price">Prix unitaire HT (EUR)</FieldLabel>
                <Input
                  id="catalogue-unit-price"
                  inputMode="decimal"
                  value={formState.unit_price_euros}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, unit_price_euros: event.target.value }))
                  }
                  placeholder="0,00"
                />
              </div>

              <div className="flex min-w-0 flex-col gap-2">
                <FieldLabel htmlFor="catalogue-tax-rate-bp">Taux de TVA</FieldLabel>
                <Input
                  id="catalogue-tax-rate-bp"
                  aria-describedby="catalogue-tax-rate-hint"
                  value={formState.tax_rate_bp}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, tax_rate_bp: event.target.value }))
                  }
                  inputMode="numeric"
                />
                {/* M-20: Helper text explaining bp */}
                <FieldDescription id="catalogue-tax-rate-hint" className="text-xs">
                  En points de base (ex. 2000 = 20 %, 550 = 5,5 %).
                </FieldDescription>
              </div>

              <label className="inline-flex min-h-9 items-center gap-2 text-sm text-foreground-secondary lg:col-span-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={formState.is_active}
                  onChange={(event) =>
                    setFormState((prev) => ({ ...prev, is_active: event.target.checked }))
                  }
                />
                Article actif
              </label>

              <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
                <Button type="submit" size="lg" loading={isSaving}>
                  {editingItem ? "Mettre à jour" : "Ajouter l’article"}
                </Button>

                {editingItem ? (
                  <Button variant="outline" size="lg" onClick={resetForm} disabled={isSaving}>
                    Annuler
                  </Button>
                ) : null}
              </div>
            </form>
          </PageSection>
        </TabsContent>

        {/* ===== LIAISON TAB ===== */}
        <TabsContent value="liaison" className="mt-4">
          <PageSection
            title="Liaison des lignes importées au catalogue"
            description="Associe les lignes mappées aux produits du catalogue par référence et désignation."
          >
            <div className="grid gap-4 lg:grid-cols-3">
              {/* M-16: Dropdown instead of UUID input */}
              <div className="flex min-w-0 flex-col gap-2 lg:col-span-2">
                <FieldLabel htmlFor="catalogue-link-import-id">Import source</FieldLabel>
                <NativeSelect
                  id="catalogue-link-import-id"
                  value={linkImportId}
                  onChange={(event) => setLinkImportId(event.target.value)}
                >
                  <option value="">Sélectionnez un import…</option>
                  {availableImports.map((imp) => (
                    <option key={imp.id} value={imp.id}>
                      {imp.filename} — {imp.row_count} lignes ({imp.status})
                    </option>
                  ))}
                </NativeSelect>
              </div>

              {/* M-21: Advanced options */}
              <div className="flex items-end">
                <Button
                  variant="outline"
                  size="lg"
                  aria-expanded={showAdvancedOptions}
                  aria-controls="catalogue-link-advanced"
                  onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
                  rightIcon={
                    <ChevronDownIcon
                      aria-hidden="true"
                      className={showAdvancedOptions ? "rotate-180 transition-transform" : "transition-transform"}
                    />
                  }
                >
                  Options avancées
                </Button>
              </div>
            </div>

            {showAdvancedOptions ? (
              <div
                id="catalogue-link-advanced"
                className="mt-4 grid gap-4 rounded-lg border border-border bg-surface-subtle p-4 lg:grid-cols-2"
              >
                <div className="flex min-w-0 flex-col gap-2">
                  {/* M-21: Renamed "Limite scan" */}
                  <FieldLabel htmlFor="catalogue-link-limit">Nombre max de lignes à analyser</FieldLabel>
                  <NumberInput
                    id="catalogue-link-limit"
                    className={cn(controlSurface, controlSizes.md, "w-full")}
                    min={1}
                    max={5000}
                    value={linkLimit}
                    parseValue={(value) => {
                      const parsedValue = parseLocalizedNumberInput(value);
                      return parsedValue !== null && Number.isInteger(parsedValue) ? parsedValue : null;
                    }}
                    emptyValue={1}
                    onValueChange={setLinkLimit}
                  />
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <label className="inline-flex min-h-9 items-center gap-2 text-sm text-foreground-secondary">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={linkCreateMissing}
                      onChange={(event) => setLinkCreateMissing(event.target.checked)}
                    />
                    Créer les articles manquants
                  </label>
                  <label className="inline-flex min-h-9 items-center gap-2 text-sm text-foreground-secondary">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={linkUpdatePayload}
                      onChange={(event) => setLinkUpdatePayload(event.target.checked)}
                    />
                    Mettre à jour le payload mappé
                  </label>
                </div>
              </div>
            ) : null}

            <div className="mt-4">
              {/* M-21: Renamed "Dry run" */}
              <label className="inline-flex min-h-9 items-center gap-2 text-sm text-foreground-secondary">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={linkDryRun}
                  onChange={(event) => setLinkDryRun(event.target.checked)}
                />
                Simulation (sans modification)
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                variant="accent"
                size="lg"
                onClick={() => void onRunLinking()}
                disabled={!linkImportId}
                loading={isLinking}
              >
                Lancer la liaison
              </Button>

              <Link
                href="/dashboard/mappings"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Retour au mapping
              </Link>
            </div>

            {/* M-18 + M-19: Detailed linking results */}
            {linkSummary ? (
              <div className="mt-6 space-y-4">
                {/* M-19: Completion summary */}
                <Alert variant={linkSummary.unmatched_count === 0 ? "success" : "warning"}>
                  <AlertTitle className="text-foreground">
                    {linkSummary.dry_run ? "Simulation terminée" : "Liaison terminée"}
                  </AlertTitle>
                  <AlertDescription>
                    {linkRate !== null ? `Taux de liaison : ${linkRate} %` : "Aucune ligne analysée"}
                  </AlertDescription>
                </Alert>

                {/* Summary counters */}
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3 text-center">
                    <dt className="text-micro uppercase tracking-wide text-muted-foreground">Analysées</dt>
                    <dd className="mt-1 text-lg font-bold text-foreground">{linkSummary.scanned_rows}</dd>
                  </div>
                  <div className="rounded-lg border border-success-border bg-success-subtle px-4 py-3 text-center">
                    <dt className="text-micro uppercase tracking-wide text-success">Liées</dt>
                    <dd className="mt-1 text-lg font-bold text-success">{linkSummary.linked_count}</dd>
                  </div>
                  <div className="rounded-lg border border-info-border bg-info-subtle px-4 py-3 text-center">
                    <dt className="text-micro uppercase tracking-wide text-info">Créées au catalogue</dt>
                    <dd className="mt-1 text-lg font-bold text-info">{linkSummary.created_catalogue_count}</dd>
                  </div>
                  <div
                    className={cn(
                      "rounded-lg border px-4 py-3 text-center",
                      linkSummary.unmatched_count > 0
                        ? "border-danger-border bg-danger-subtle"
                        : "border-border bg-surface-subtle"
                    )}
                  >
                    <dt
                      className={cn(
                        "text-micro uppercase tracking-wide",
                        linkSummary.unmatched_count > 0 ? "text-danger" : "text-muted-foreground"
                      )}
                    >
                      Sans correspondance
                    </dt>
                    <dd
                      className={cn(
                        "mt-1 text-lg font-bold",
                        linkSummary.unmatched_count > 0 ? "text-danger" : "text-foreground"
                      )}
                    >
                      {linkSummary.unmatched_count}
                    </dd>
                  </div>
                </dl>

                {/* M-19: Next step link */}
                {!linkSummary.dry_run && linkSummary.linked_count > 0 ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href="/dashboard/imports"
                      className={buttonVariants({ variant: "primary", size: "lg" })}
                    >
                      Retour aux imports
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      Flux terminé. Vous pouvez lancer un nouvel import ou consulter le catalogue.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </PageSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
