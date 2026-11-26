"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { useConfirm } from "@/components/feedback/confirm-provider";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useOptionalUserContext } from "@/lib/auth/user-context";
import { fetchCatalogueImportBatches, undoCatalogueImport, validateDraftProducts } from "@/lib/catalogue/import-review-client";
import type { CatalogueImportBatch } from "@/lib/catalogue/import-review-contract";
import { bulkValidationSummary, CATALOGUE_BULK_INCOMPLETE } from "@/lib/catalogue/import-review-feedback";
import { isEstimateApiError } from "@/lib/estimates/client-errors";
import { catalogueErrorMessage } from "@/lib/catalogue/supplier-items-client";

import { formatCount, plural } from "./shared";

/**
 * The latest imports of the costing workbook and what is left to do on each (TI-711): validate the complete
 * drafts of an import together, check its references together, or undo it. An undo removes only what the import
 * created and nobody touched since: untouched drafts and references still « à vérifier ».
 */

const MOMENT = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
});

type Message = { tone: "success" | "danger"; text: string };
const visibleBatches = (items: CatalogueImportBatch[]) =>
  items.filter((batch) => batch.kind !== "workbook_articles" || batch.total > 0 || batch.undone_at);

export function ImportBatchesPanel({ refreshKey, draftsHref, onChanged }: Readonly<{
  /** Changes after each confirmed import: the list is read again. */
  refreshKey: number;
  draftsHref: string;
  /** Drafts were validated or removed: the catalogue's cached pages no longer hold. */
  onChanged: () => void | Promise<void>;
}>) {
  const confirm = useConfirm();
  const isAdmin = useOptionalUserContext()?.profile?.tenant_role === "admin";
  const [batches, setBatches] = useState<CatalogueImportBatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetchCatalogueImportBatches(abort.signal).then(
      (items) => {
        if (abort.signal.aborted) return;
        setBatches(visibleBatches(items));
        setFailed(false);
      },
      () => { if (!abort.signal.aborted) setFailed(true); },
    );
    return () => abort.abort();
  }, [refreshKey, reload]);

  async function run(batch: CatalogueImportBatch, action: () => Promise<string>, fallback: string) {
    setWorking(batch.id);
    setMessage(null);
    try {
      setMessage({ tone: "success", text: await action() });
      await onChanged();
    } catch (failure) {
      setMessage({ tone: "danger", text: catalogueErrorMessage(failure, fallback) });
    } finally {
      setWorking(null);
      setReload((value) => value + 1);
    }
  }

  const validate = (batch: CatalogueImportBatch) => run(batch, async () => {
    try {
      return bulkValidationSummary(await validateDraftProducts({ import_batch_id: batch.id }));
    } catch (failure) {
      if (isEstimateApiError(failure) && failure.code === CATALOGUE_BULK_INCOMPLETE) {
        await Promise.allSettled([
          Promise.resolve().then(onChanged),
          fetchCatalogueImportBatches().then((items) => setBatches(visibleBatches(items))),
        ]);
      }
      throw failure;
    }
  }, "Ces brouillons n’ont pas pu être validés.");

  async function undo(batch: CatalogueImportBatch) {
    const articles = batch.kind === "workbook_articles";
    const confirmed = await confirm({
      title: articles ? "Annuler cet import d’articles ?" : "Annuler cet import de références ?",
      description: articles
        ? "Les brouillons de cet import que personne n’a validés ni utilisés sont supprimés, avec leurs références à vérifier. Les articles validés sont conservés."
        : "Les références de cet import encore à vérifier sont supprimées. Celles déjà vérifiées sont conservées.",
      confirmLabel: "Annuler l’import",
      tone: "danger",
    });
    if (!confirmed) return;
    await run(batch, async () => {
      const { deleted, kept } = await undoCatalogueImport(batch.id);
      const noun = articles ? ["brouillon supprimé", "brouillons supprimés"] : ["référence supprimée", "références supprimées"];
      const left = kept > 0 ? ` ${formatCount(kept)} ${plural(kept, "conservé", "conservés")}.` : "";
      return `Import annulé : ${formatCount(deleted)} ${plural(deleted, noun[0], noun[1])}.${left}`;
    }, "Cet import n’a pas pu être annulé.");
  }

  if (failed && batches === null) return null;
  if (batches === null || batches.length === 0) return null;

  return (
    <section aria-labelledby="costing-workbook-batches-title" className="mt-6 space-y-3 rounded-lg border border-border bg-surface p-4 sm:p-5">
      <h2 id="costing-workbook-batches-title" className="typo-h3">Imports récents</h2>
      {message ? <Alert variant={message.tone}>{message.text}</Alert> : null}
      <ul aria-label="Imports récents" className="divide-y divide-border">
        {batches.map((batch) => {
          const articles = batch.kind === "workbook_articles";
          const busy = working !== null;
          const undoInProgress = Boolean(batch.undo_started_at && !batch.undone_at);
          return (
            <li key={batch.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{articles ? "Articles en brouillon" : "Références fournisseur"}</span>
                  <span className="font-normal text-muted-foreground">{MOMENT.format(new Date(batch.created_at))}</span>
                  {batch.undone_at ? <Badge variant="neutral" size="sm">annulé</Badge> : null}
                  {undoInProgress ? <Badge variant="neutral" size="sm">Annulation en cours</Badge> : null}
                </p>
                <p className="text-xs text-muted-foreground wrap-anywhere">
                  {batch.source_name ? `${batch.source_name} · ` : ""}
                  {articles
                    ? `${formatCount(batch.total)} ${plural(batch.total, "article", "articles")}, dont ${formatCount(batch.open)} encore en brouillon`
                    : `${formatCount(batch.total)} ${plural(batch.total, "référence", "références")}, dont ${formatCount(batch.open)} à vérifier`}
                </p>
              </div>
              {batch.undone_at ? null : (
                <div className="flex flex-wrap items-center gap-2">
                  {articles && batch.open > 0 ? (
                    <>
                      <Link className={buttonVariants({ variant: "outline", size: "sm" })} href={draftsHref}>Voir les brouillons</Link>
                      {isAdmin ? (
                        <Button variant="secondary" size="sm" loading={working === batch.id} disabled={busy} onClick={() => void validate(batch)}>
                          Valider les brouillons complets
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                  {!articles && batch.open > 0 ? (
                    <Link
                      className={buttonVariants({ variant: "secondary", size: "sm" })}
                      href={`/dashboard/products/supplier-references?${new URLSearchParams({ import_batch_id: batch.id })}`}
                    >
                      Vérifier les références
                    </Link>
                  ) : null}
                  {batch.can_undo && (batch.open > 0 || undoInProgress) ? (
                    <Button variant="danger" size="sm" disabled={busy} onClick={() => void undo(batch)}>Annuler l’import</Button>
                  ) : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {isAdmin ? null : (
        <p className="text-xs text-muted-foreground">La validation des brouillons est réservée aux administrateurs.</p>
      )}
    </section>
  );
}
