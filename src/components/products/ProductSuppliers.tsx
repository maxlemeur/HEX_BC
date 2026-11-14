"use client";

import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { ExternalLink, PencilIcon, PlusIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  catalogueErrorMessage,
  fetchArticleSuppliers,
  fetchSupplierDirectory,
  safeProductUrl,
  saveArticlePreferredSupplier,
  saveArticleSupplierItem,
  type SupplierDirectoryEntry,
} from "@/lib/catalogue/supplier-items-client";
import {
  SUPPLIER_PRODUCT_URL_MAX,
  SUPPLIER_SKU_MAX,
  type ArticleSupplierItem,
} from "@/lib/material-requests/supplier-contracts";

import { useSerialSave } from "./useSerialSave";

type SuppliersState =
  | { productId: string; status: "ready"; items: ArticleSupplierItem[]; preferred: string | null }
  | { productId: string; status: "error" };

type Draft = { supplierId: string; sku: string; url: string };

const EMPTY_DRAFT: Draft = { supplierId: "", sku: "", url: "" };

function text(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Enter saves the small form it is typed in; it must never submit the article form around it. */
function onEnter(action: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    action();
  };
}

/** The server holds one item per supplier: its answer replaces ours, or joins the list. */
function upsert(items: ArticleSupplierItem[], saved: ArticleSupplierItem): ArticleSupplierItem[] {
  return items.some((item) => item.supplier_id === saved.supplier_id)
    ? items.map((item) => (item.supplier_id === saved.supplier_id ? saved : item))
    : [...items, saved];
}

function SupplierFields({
  idPrefix,
  skuLabel,
  urlLabel,
  draft,
  onChange,
  onSubmit,
}: Readonly<{
  idPrefix: string;
  skuLabel: string;
  urlLabel: string;
  draft: Draft;
  onChange: (draft: Draft) => void;
  onSubmit: () => void;
}>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-sku`}>{skuLabel}</FieldLabel>
        <Input
          id={`${idPrefix}-sku`}
          autoComplete="off"
          maxLength={SUPPLIER_SKU_MAX}
          value={draft.sku}
          onChange={(event) => onChange({ ...draft, sku: event.target.value })}
          onKeyDown={onEnter(onSubmit)}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <FieldLabel htmlFor={`${idPrefix}-url`}>{urlLabel}</FieldLabel>
        {/* Text, not type="url": an invalid address here must not hold back the article form's own save. */}
        <Input
          id={`${idPrefix}-url`}
          inputMode="url"
          autoComplete="off"
          placeholder="https://"
          maxLength={SUPPLIER_PRODUCT_URL_MAX}
          value={draft.url}
          onChange={(event) => onChange({ ...draft, url: event.target.value })}
          onKeyDown={onEnter(onSubmit)}
        />
      </div>
    </div>
  );
}

/**
 * The suppliers of an article (TI-691, lot 2): its reference at each one, without any price (prices live
 * in the price book), and the article's preferred supplier, proposed on request lines before the one of
 * its supply type. Each change is saved at once; the server decides who may make it and says so.
 */
export function ProductSuppliers({
  productId,
  onChanged,
}: Readonly<{
  productId: string;
  onChanged?: () => void;
}>) {
  const ids = useId();
  const [state, setState] = useState<SuppliersState | null>(null);
  const [directory, setDirectory] = useState<SupplierDirectoryEntry[] | "error" | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedPreferred, setSavedPreferred] = useState(false);
  /** The last preferred supplier chosen, while its save is on its way: shown until its answer. */
  const [pendingPreferred, setPendingPreferred] = useState<{ value: string | null } | null>(null);
  const savePreferred = useSerialSave();

  useEffect(() => {
    const abort = new AbortController();
    fetchArticleSuppliers(productId, abort.signal)
      .then((answer) => {
        if (abort.signal.aborted) return;
        setState({ productId, status: "ready", items: answer.items, preferred: answer.preferred_supplier_id });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ productId, status: "error" });
      });
    return () => abort.abort();
  }, [productId]);

  // The directory is only needed to add a supplier: read when the office asks to.
  useEffect(() => {
    if (!adding || directory !== null) return;
    const abort = new AbortController();
    fetchSupplierDirectory(abort.signal)
      .then((entries) => {
        if (!abort.signal.aborted) setDirectory(entries);
      })
      .catch(() => {
        if (!abort.signal.aborted) setDirectory("error");
      });
    return () => abort.abort();
  }, [adding, directory]);

  const current = state?.productId === productId ? state : null;
  const active = useMemo(
    () => (current?.status === "ready" ? current.items.filter((item) => item.is_active) : []),
    [current],
  );
  const addable = useMemo(
    () =>
      Array.isArray(directory)
        ? directory.filter((entry) => !active.some((item) => item.supplier_id === entry.id))
        : [],
    [active, directory],
  );

  const save = async (key: string, input: Parameters<typeof saveArticleSupplierItem>[1]) => {
    setBusy(key);
    setError(null);
    setSavedPreferred(false);
    try {
      // The exception comes back with the item: withdrawing the supplier it names clears it.
      const stored = await saveArticleSupplierItem(productId, input);
      setState((previous) =>
        previous?.status === "ready"
          ? { ...previous, items: upsert(previous.items, stored.item), preferred: stored.preferred_supplier_id }
          : previous,
      );
      onChanged?.();
      return true;
    } catch (failure) {
      setError(catalogueErrorMessage(failure, "Le fournisseur de l’article n’a pas pu être enregistré."));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (!draft.supplierId || (!text(draft.sku) && !text(draft.url)) || busy) return;
    const ok = await save("add", {
      supplier_id: draft.supplierId,
      supplier_sku: text(draft.sku),
      product_url: text(draft.url),
      is_active: true,
    });
    if (ok) {
      setDraft(EMPTY_DRAFT);
      setAdding(false);
    }
  };

  const update = async (item: ArticleSupplierItem) => {
    if ((!text(editDraft.sku) && !text(editDraft.url)) || busy) return;
    // Both fields are on screen: both are sent, a field emptied by the office clears what is stored.
    const ok = await save(item.supplier_id, {
      supplier_id: item.supplier_id,
      supplier_sku: text(editDraft.sku),
      product_url: text(editDraft.url),
      is_active: true,
    });
    if (ok) setEditing(null);
  };

  // Withdrawn, not deleted: the keys left out keep the stored reference, and its prices stay in the price book.
  const withdraw = (item: ArticleSupplierItem) => save(item.supplier_id, { supplier_id: item.supplier_id, is_active: false });

  // Never disabled while it saves: the saves leave one after another, and the last answer speaks.
  const choosePreferred = async (supplierId: string | null) => {
    if (current?.status !== "ready") return;
    setPendingPreferred({ value: supplierId });
    setError(null);
    setSavedPreferred(false);
    const outcome = await savePreferred(() => saveArticlePreferredSupplier(productId, supplierId));
    // Every answer says what the server holds now, even one a later choice has overtaken.
    if (outcome.ok) {
      setState((previous) => (previous?.status === "ready" ? { ...previous, preferred: outcome.value } : previous));
    }
    if (!outcome.latest) return;
    setPendingPreferred(null);
    if (outcome.ok) {
      setSavedPreferred(true);
      onChanged?.();
    } else {
      // The select goes back to what the server holds, with its sentence.
      setError(catalogueErrorMessage(outcome.error, "Le fournisseur privilégié de l’article n’a pas pu être enregistré."));
    }
  };

  const headingId = `${ids}-heading`;
  const addHintId = `${ids}-add-hint`;
  const preferredId = `${ids}-preferred`;
  const preferredHintId = `${ids}-preferred-hint`;
  const withdrawHintId = `${ids}-withdraw-hint`;
  const saved = current?.status === "ready" ? current.preferred : null;
  const preferred = pendingPreferred ? pendingPreferred.value : saved;
  const preferredKnown = preferred === null || active.some((item) => item.supplier_id === preferred);
  const draftComplete = Boolean(draft.supplierId) && Boolean(text(draft.sku) || text(draft.url));

  return (
    <section aria-labelledby={headingId} className="border-t border-border pt-4">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        Fournisseurs de l’article
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Sa référence chez chaque fournisseur, sans prix : les prix restent dans les tarifs. Chaque changement est
        enregistré aussitôt.
      </p>
      {current === null ? <p className="mt-2 text-sm text-muted-foreground">Chargement…</p> : null}
      {current?.status === "error" ? (
        <p className="mt-2 text-sm text-danger">Les fournisseurs de l’article n’ont pas pu être chargés.</p>
      ) : null}
      {current?.status === "ready" && active.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Aucun fournisseur pour cet article.</p>
      ) : null}
      {current?.status === "ready" && active.length > 0 ? (
        <ul aria-label="Fournisseurs de l’article" className="mt-2 divide-y divide-border rounded-lg border border-border">
          {active.map((item) => {
            const url = safeProductUrl(item.product_url);
            const isEditing = editing === item.supplier_id;
            const editPrefix = `${ids}-edit-${item.supplier_id}`;
            return (
              <li key={item.supplier_id} className="space-y-2 px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
                      <span className="min-w-0 break-words">{item.supplier_name}</span>
                      {item.has_price ? (
                        <Badge variant="success" size="sm">
                          avec prix
                        </Badge>
                      ) : null}
                      {preferred === item.supplier_id ? (
                        <Badge variant="info" size="sm">
                          privilégié
                        </Badge>
                      ) : null}
                    </p>
                    <p className="break-all font-mono text-xs text-foreground-secondary">
                      {item.supplier_sku ? `Réf. ${item.supplier_sku}` : "Sans référence"}
                    </p>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
                        Fiche chez {item.supplier_name}
                      </a>
                    ) : null}
                  </div>
                  {isEditing ? null : (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy !== null}
                        aria-label={`Modifier ${item.supplier_name}`}
                        onClick={() => {
                          setError(null);
                          setEditing(item.supplier_id);
                          setEditDraft({
                            supplierId: item.supplier_id,
                            sku: item.supplier_sku ?? "",
                            url: item.product_url ?? "",
                          });
                        }}
                      >
                        <PencilIcon aria-hidden="true" />
                        Modifier
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        loading={busy === item.supplier_id}
                        disabled={busy !== null && busy !== item.supplier_id}
                        aria-label={`Retirer ${item.supplier_name} de l’article`}
                        aria-describedby={withdrawHintId}
                        onClick={() => void withdraw(item)}
                      >
                        <XIcon aria-hidden="true" />
                        Retirer
                      </Button>
                    </div>
                  )}
                </div>
                {isEditing ? (
                  <div className="space-y-2 rounded-lg border border-border bg-surface-subtle p-3">
                    <SupplierFields
                      idPrefix={editPrefix}
                      skuLabel={`Référence chez ${item.supplier_name}`}
                      urlLabel={`Lien chez ${item.supplier_name} (facultatif)`}
                      draft={editDraft}
                      onChange={setEditDraft}
                      onSubmit={() => void update(item)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        loading={busy === item.supplier_id}
                        disabled={!text(editDraft.sku) && !text(editDraft.url)}
                        onClick={() => void update(item)}
                      >
                        Enregistrer la référence
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label="Annuler la modification"
                        onClick={() => setEditing(null)}
                      >
                        Annuler
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {current?.status === "ready" && active.length > 0 ? (
        <p id={withdrawHintId} className="mt-1.5 text-xs text-muted-foreground">
          Les prix de ce fournisseur restent enregistrés mais ne sont plus proposés tant qu’il est retiré de l’article.
        </p>
      ) : null}

      {current?.status === "ready" ? (
        <div className="mt-3 space-y-3">
          {adding ? (
            <div className="space-y-3 rounded-lg border border-border bg-surface-subtle p-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <FieldLabel htmlFor={`${ids}-add-supplier`}>Fournisseur à ajouter</FieldLabel>
                <NativeSelect
                  id={`${ids}-add-supplier`}
                  value={draft.supplierId}
                  aria-describedby={addHintId}
                  onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })}
                >
                  <option value="">
                    {directory === null ? "Chargement…" : directory === "error" ? "Liste indisponible" : "Choisir"}
                  </option>
                  {addable.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <SupplierFields
                idPrefix={`${ids}-add`}
                skuLabel="Référence chez ce fournisseur"
                urlLabel="Lien vers l’article (facultatif)"
                draft={draft}
                onChange={setDraft}
                onSubmit={() => void add()}
              />
              <p id={addHintId} className="text-xs text-muted-foreground">
                {directory === "error"
                  ? "La liste des fournisseurs n’a pas pu être chargée."
                  : "Une référence ou un lien suffit. Le prix se saisit dans les tarifs."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={busy === "add"}
                  disabled={!draftComplete}
                  onClick={() => void add()}
                >
                  Ajouter ce fournisseur
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Annuler l’ajout"
                  onClick={() => {
                    setAdding(false);
                    setDraft(EMPTY_DRAFT);
                  }}
                >
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<PlusIcon aria-hidden="true" />}
              disabled={busy !== null}
              onClick={() => {
                setError(null);
                setAdding(true);
              }}
            >
              Ajouter un fournisseur
            </Button>
          )}

          <div className="flex min-w-0 flex-col gap-1.5">
            <FieldLabel htmlFor={preferredId}>Fournisseur privilégié pour cet article</FieldLabel>
            <NativeSelect
              id={preferredId}
              value={preferred ?? ""}
              aria-describedby={preferredHintId}
              onChange={(event) => void choosePreferred(event.target.value || null)}
            >
              <option value="">Aucun : celui du type de fourniture</option>
              {preferredKnown ? null : <option value={preferred ?? ""}>Fournisseur retiré de l’article</option>}
              {active.map((item) => (
                <option key={item.supplier_id} value={item.supplier_id}>
                  {item.supplier_name}
                </option>
              ))}
            </NativeSelect>
            <p id={preferredHintId} className="text-xs text-muted-foreground">
              Proposé avant le fournisseur du type sur les demandes de matériel.
            </p>
            <p role="status" className="text-xs text-success empty:hidden">
              {savedPreferred ? "Fournisseur privilégié enregistré." : ""}
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
