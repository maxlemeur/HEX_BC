"use client";

import { useEffect, useId, useState } from "react";
import { XIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import { Button } from "@/components/ui/button";

type ProductAlias = { id: string; alias: string; created_at: string };

type AliasesState =
  | { productId: string; status: "ready"; items: ProductAlias[] }
  | { productId: string; status: "error" };

function aliasesPath(productId: string, aliasId?: string) {
  const base = `/api/products/${encodeURIComponent(productId)}/aliases`;
  return aliasId ? `${base}/${encodeURIComponent(aliasId)}` : base;
}

/**
 * The usual names of an article (TI-690, delivery 3): the technicians' words the office taught it by
 * linking request lines. The matcher proposes the article for them; a wrong one is removed here.
 * The server decides who may remove one and says so when it refuses.
 */
export function ProductAliases({ productId }: Readonly<{ productId: string }>) {
  const headingId = useId();
  const [state, setState] = useState<AliasesState | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    fetchApi<{ items: ProductAlias[] }>(aliasesPath(productId), { signal: abort.signal })
      .then(({ items }) => {
        if (!abort.signal.aborted) setState({ productId, status: "ready", items: items ?? [] });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ productId, status: "error" });
      });
    return () => abort.abort();
  }, [productId]);

  const current = state?.productId === productId ? state : null;

  const remove = async (alias: ProductAlias) => {
    setRemoving(alias.id);
    setError(null);
    try {
      await fetchApi<{ deleted: boolean }>(aliasesPath(productId, alias.id), { method: "DELETE" });
      setState((previous) =>
        previous?.status === "ready"
          ? { ...previous, items: previous.items.filter((item) => item.id !== alias.id) }
          : previous,
      );
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Le nom usuel n’a pas pu être retiré.");
    } finally {
      setRemoving(null);
    }
  };

  return (
    <section aria-labelledby={headingId} className="border-t border-border pt-4">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        Noms usuels
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Les mots des techniciens pour cet article, retenus quand une ligne de demande y est rattachée.
      </p>
      {current === null ? <p className="mt-2 text-sm text-muted-foreground">Chargement…</p> : null}
      {current?.status === "error" ? (
        <p className="mt-2 text-sm text-danger">Les noms usuels n’ont pas pu être chargés.</p>
      ) : null}
      {current?.status === "ready" && current.items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Aucun nom usuel pour le moment.</p>
      ) : null}
      {current?.status === "ready" && current.items.length > 0 ? (
        <ul aria-label="Noms usuels" className="mt-2 flex flex-wrap gap-2">
          {current.items.map((item) => (
            <li
              key={item.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-surface-subtle py-0.5 pr-0.5 pl-3 text-sm text-foreground"
            >
              <span className="min-w-0 break-words">{item.alias}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-8 shrink-0 rounded-full"
                loading={removing === item.id}
                disabled={removing !== null && removing !== item.id}
                aria-label={`Retirer le nom usuel « ${item.alias} »`}
                onClick={() => void remove(item)}
              >
                <XIcon aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
