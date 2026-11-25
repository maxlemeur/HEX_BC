"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import useSWR from "swr";
import { ExternalLinkIcon } from "lucide-react";

import { ListPagination } from "@/components/catalogue/ListPagination";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { fetchPendingSupplierReferences, reviewSupplierReferences } from "@/lib/catalogue/import-review-client";
import {
  CATALOGUE_BULK_INCOMPLETE,
  PENDING_REFERENCE_PAGE_SIZES,
  type PendingSupplierReferencePage,
  type PendingReferencesQuery,
  type ReviewReferencesInput,
} from "@/lib/catalogue/import-review-contract";
import { isEstimateApiError } from "@/lib/estimates/client-errors";
import {
  catalogueErrorMessage,
  fetchSupplierDirectory,
  safeProductUrl,
  type SupplierDirectoryEntry,
} from "@/lib/catalogue/supplier-items-client";

/**
 * The supplier references an import left « à vérifier » (TI-711), in one list. Until it is checked, a reference
 * is not used for purchasing; the article's form checks them one by one, this page checks a selection, a
 * supplier's references or the whole list at once. Nothing is checked without the office asking for it.
 */

type PageSize = (typeof PENDING_REFERENCE_PAGE_SIZES)[number];
type Filter = Pick<PendingReferencesQuery, "supplier_id" | "import_batch_id" | "q">;

const count = (value: number) => value.toLocaleString("fr-FR");
const plural = (value: number, one: string, many: string) => (value === 1 ? one : many);
const DAY = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });

export function SupplierReferenceQueue({ initialImportBatchId }: Readonly<{ initialImportBatchId: string | null }>) {
  const confirm = useConfirm();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(50);
  const [supplierId, setSupplierId] = useState("");
  const [importBatchId, setImportBatchId] = useState(initialImportBatchId ?? "");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [directory, setDirectory] = useState<SupplierDirectoryEntry[]>([]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const abort = new AbortController();
    fetchSupplierDirectory(abort.signal).then((entries) => setDirectory(entries), () => undefined);
    return () => abort.abort();
  }, []);

  const filter = useMemo<Filter>(() => ({
    ...(supplierId ? { supplier_id: supplierId } : {}),
    ...(importBatchId ? { import_batch_id: importBatchId } : {}),
    ...(search ? { q: search } : {}),
  }), [importBatchId, search, supplierId]);
  const { data, error, isLoading, mutate } = useSWR<PendingSupplierReferencePage>(
    ["pending-supplier-references", page, size, filter],
    () => fetchPendingSupplierReferences({ page, size, ...filter }),
    { revalidateOnFocus: true },
  );
  const ready = Boolean(data) && !isLoading && !error && searchInput.trim() === search;
  const items = data?.items ?? [];
  const total = data?.pagination.totalItems ?? 0;
  const reviewable = items.filter((item) => item.can_review);
  const selectedOnPage = reviewable.filter((item) => selected.has(item.id));
  const allSelected = reviewable.length > 0 && selectedOnPage.length === reviewable.length;

  function changeFilter(change: () => void) {
    change();
    setPage(1);
    setSelected(new Set());
    setMessage(null);
  }

  async function review(input: ReviewReferencesInput, asked: number) {
    setBusy(true);
    setMessage(null);
    try {
      const { reviewed, skipped } = await reviewSupplierReferences(input);
      const done = input.action === "validate"
        ? `${count(reviewed)} ${plural(reviewed, "référence validée", "références validées")}`
        : `${count(reviewed)} ${plural(reviewed, "référence retirée", "références retirées")}`;
      const left = skipped > 0
        ? ` ${count(skipped)} sur ${count(asked)} ${plural(skipped, "laissée", "laissées")} en attente : article ou fournisseur archivé, ou droits de modification requis.`
        : "";
      setMessage({ tone: "success", text: `${done}.${left}` });
      setSelected(new Set());
      await mutate();
    } catch (failure) {
      setMessage({ tone: "danger", text: catalogueErrorMessage(failure, "Ces références n’ont pas pu être vérifiées.") });
      if (isEstimateApiError(failure) && (failure.status === 409 || failure.code === CATALOGUE_BULK_INCOMPLETE)) {
        setSelected(new Set());
        await mutate().catch(() => undefined);
      }
    } finally {
      setBusy(false);
    }
  }

  async function validateAll() {
    if (!ready || busy || total === 0) return;
    const confirmed = await confirm({
      title: `Valider ${count(total)} ${plural(total, "référence", "références")} ?`,
      description: "Elles serviront aux achats telles que le classeur les donne. Une référence validée se corrige ensuite depuis la fiche de son article.",
      confirmLabel: "Valider",
    });
    if (confirmed) await review({ action: "validate", filter, expected_count: total }, total);
  }

  async function withdrawSelection() {
    const ids = selectedOnPage.map((item) => item.id);
    const confirmed = await confirm({
      title: `Retirer ${count(ids.length)} ${plural(ids.length, "référence", "références")} ?`,
      description: "Le code importé est abandonné : le fournisseur n’est pas rattaché à l’article.",
      confirmLabel: "Retirer",
      tone: "danger",
    });
    if (confirmed) await review({ action: "withdraw", ids }, ids.length);
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Référentiel", href: "/dashboard/referentiel" },
          { label: "Produits", href: "/dashboard/products" },
          { label: "Références à vérifier" },
        ]}
        title="Références fournisseur à vérifier"
        description="Une référence importée ne sert aux achats qu’une fois vérifiée. Validez-les ensemble, par fournisseur ou par sélection."
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <label htmlFor="pending-references-supplier" className="mb-1 block text-xs font-medium text-muted-foreground">Fournisseur</label>
          <NativeSelect
            id="pending-references-supplier"
            size="sm"
            value={supplierId}
            onChange={(event) => changeFilter(() => setSupplierId(event.currentTarget.value))}
          >
            <option value="">Tous les fournisseurs</option>
            {directory.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </NativeSelect>
        </div>
        <div className="w-full sm:w-64">
          <label htmlFor="pending-references-search" className="mb-1 block text-xs font-medium text-muted-foreground">Référence fournisseur</label>
          <Input
            id="pending-references-search"
            type="search"
            size="sm"
            placeholder="Partie du code"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.currentTarget.value);
              setSelected(new Set());
            }}
          />
        </div>
        {importBatchId ? (
          <Button variant="outline" size="sm" onClick={() => changeFilter(() => setImportBatchId(""))}>
            Voir tous les imports
          </Button>
        ) : null}
      </div>

      <div aria-live="polite" className="mb-4 space-y-3 empty:hidden">
        {message ? <Alert variant={message.tone}>{message.text}</Alert> : null}
        {error ? <Alert variant="danger">{catalogueErrorMessage(error, "Les références à vérifier n’ont pas pu être chargées.")}</Alert> : null}
      </div>

      <section aria-label="Références à vérifier" aria-busy={busy} className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5 sm:px-4">
          <p className="text-sm text-muted-foreground">
            {importBatchId ? "Import sélectionné · " : ""}
            {`${count(total)} ${plural(total, "référence à vérifier", "références à vérifier")}`}
            {selectedOnPage.length > 0 ? ` · ${count(selectedOnPage.length)} ${plural(selectedOnPage.length, "sélectionnée", "sélectionnées")}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !ready || selectedOnPage.length === 0}
              onClick={() => void review({ action: "validate", ids: selectedOnPage.map((item) => item.id) }, selectedOnPage.length)}
            >
              Valider la sélection
            </Button>
            <Button variant="danger" size="sm" disabled={busy || !ready || selectedOnPage.length === 0} onClick={() => void withdrawSelection()}>
              Retirer la sélection
            </Button>
            <Button variant="secondary" size="sm" loading={busy} disabled={busy || !ready || total === 0} onClick={() => void validateAll()}>
              {`Valider les ${count(total)} ${plural(total, "référence", "références")}`}
            </Button>
          </div>
        </div>

        {isLoading && !data ? <LoadingState label="Chargement des références…" className="py-10" /> : null}
        {data && total === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {supplierId || search || importBatchId ? "Aucune référence à vérifier ne correspond à ces filtres." : "Aucune référence à vérifier."}
          </p>
        ) : null}
        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <table aria-label="Références fournisseur à vérifier" className="w-full min-w-160 text-left text-sm">
              <thead className="border-b border-border bg-surface-subtle text-xs text-muted-foreground">
                <tr className="[&>th]:px-3 [&>th]:py-2.5">
                  <th scope="col" className="w-10">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      aria-label="Sélectionner les références de cette page"
                      checked={allSelected}
                      disabled={reviewable.length === 0}
                      onChange={(event) => setSelected(event.currentTarget.checked ? new Set(reviewable.map((item) => item.id)) : new Set())}
                    />
                  </th>
                  <th scope="col">Article</th>
                  <th scope="col">Fournisseur</th>
                  <th scope="col">Référence fournisseur</th>
                  <th scope="col">Importée le</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => {
                  const url = safeProductUrl(item.product_url);
                  return (
                    <tr key={item.id} className="align-top wrap-anywhere [&>td]:px-3 [&>td]:py-2.5">
                      <td>
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          aria-label={`Sélectionner ${item.supplier_sku ?? "la référence"} de ${item.supplier_name} pour ${item.product_reference ?? item.product_designation}`}
                          title={item.can_review ? undefined : "Seul l’auteur de l’article ou un administrateur peut vérifier cette référence."}
                          checked={selected.has(item.id)}
                          disabled={!item.can_review}
                          onChange={(event) => setSelected((previous) => {
                            const next = new Set(previous);
                            if (event.currentTarget.checked) next.add(item.id);
                            else next.delete(item.id);
                            return next;
                          })}
                        />
                      </td>
                      <td>
                        <Link
                          href={`/dashboard/products?${new URLSearchParams({ product_id: item.product_id })}`}
                          prefetch={false}
                          className="font-mono text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          {item.product_reference ?? "Sans référence"}
                        </Link>
                        <p>{item.product_designation}</p>
                      </td>
                      <td>{item.supplier_name}</td>
                      <td>
                        <p className="break-all font-mono text-xs">{item.supplier_sku ?? "—"}</p>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            Fiche fournisseur <ExternalLinkIcon className="size-3" aria-hidden="true" />
                          </a>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap text-muted-foreground">{DAY.format(new Date(item.created_at))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {total > 0 ? (
          <ListPagination
            label="Pagination des références à vérifier"
            itemsLabel="Références"
            page={page}
            totalPages={Math.max(data?.pagination.totalPages ?? 1, 1)}
            pageSize={size}
            pageSizes={PENDING_REFERENCE_PAGE_SIZES}
            onPageChange={(next) => {
              setPage(next);
              setSelected(new Set());
            }}
            onPageSizeChange={(next) => {
              setSize(next);
              setPage(1);
              setSelected(new Set());
            }}
          />
        ) : null}
      </section>
    </div>
  );
}
