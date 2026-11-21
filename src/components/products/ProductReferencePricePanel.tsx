"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetchApi } from "@/components/catalogue/api";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrencyCode, formatEUR, parseEuroToCents } from "@/lib/money";
import type { ReferencePriceHistory, ReferencePriceResponse } from "@/lib/catalogue/reference-price-schemas";

const exclusions: Record<string, string> = {
  inactive: "Offre ou fournisseur inactif", missing_supplier_reference: "Référence fournisseur manquante",
  future: "Pas encore valable", expired: "Date de validité dépassée",
  missing_quantity: "Quantité de référence à préciser", quantity: "Quantité minimale trop élevée",
  unit: "Unité différente", currency: "Devise différente", missing_transport: "Transport à préciser",
  transport: "Traitement du transport différent", zero_price: "Prix nul exclu · à clarifier",
  older_supplier_offer: "Offre plus récente retenue pour ce fournisseur",
};

function transportLabel(mode: string | null) {
  return mode === "included" ? "Transport inclus" : mode === "excluded" ? "Hors transport" : "À préciser";
}

function HistoryEntry({ event }: { event: ReferencePriceHistory["events"][number] }) {
  const withdrawal = event.operation === "withdrawal";
  const price = `${formatEUR(event.unit_price_cents)} / ${event.unit}`;
  const validation = event.operation === "average" ? "Moyenne validée" : "Prix manuel validé";
  return (
    <li className="space-y-1.5 p-3">
      <p className="font-medium text-foreground">{withdrawal ? "Retrait de la référence" : `${validation} · ${price}`}</p>
      <p className="break-words text-xs text-muted-foreground">
        {new Date(event.occurred_at).toLocaleString("fr-FR")} · {event.actor_name ?? event.actor_id}
      </p>
      <p className="text-sm text-foreground-secondary">
        {withdrawal ? `Prix retiré ${price} · ` : ""}
        {event.quantity === null ? "Quantité inconnue" : `Base ${event.quantity.toLocaleString("fr-FR")} ${event.unit}`} · {transportLabel(event.transport_mode)}
      </p>
      {event.source_order_date ? <p className="text-sm text-foreground-secondary">Commande du {event.source_order_date}</p> : null}
      {event.justification ? <p className="whitespace-pre-wrap break-words text-sm">Justification · {event.justification}</p> : null}
      {event.offers.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer rounded text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            Offres examinées ({event.offers.length})
          </summary>
          <ul className="mt-2 space-y-2 border-l border-border pl-3">
            {event.offers.map((offer) => (
              <li key={offer.id} className="break-words">
                <span className="font-medium">{offer.supplier_name}{offer.supplier_sku ? ` · ${offer.supplier_sku}` : ""}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatCurrencyCode(offer.unit_price_cents, offer.currency)} / {offer.unit}
                  {" · "}Dès {offer.min_quantity} {offer.unit} · {offer.valid_from} → {offer.valid_to ?? "Fin non renseignée"}
                  {" · "}{transportLabel(offer.transport_mode)} · {offer.exclusion ? exclusions[offer.exclusion] : "Retenue"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

export function ProductReferencePricePanel({ productId, onValidated }: {
  productId: string; onValidated?: () => void;
}) {
  const [quantity, setQuantity] = useState<string | null>(null);
  const [transport, setTransport] = useState<string | null>(null);
  const [basis, setBasis] = useState<{ quantity: number; transport: string } | null>(null);
  const [manual, setManual] = useState(false);
  const [manualPrice, setManualPrice] = useState("");
  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [withdrawalTarget, setWithdrawalTarget] = useState<ReferencePriceResponse["proposal"] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const generation = useRef(0);
  const withdrawButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const currentGeneration = generation.current + 1;
    generation.current = currentGeneration;
    return () => { generation.current = currentGeneration + 1; };
  }, [productId]);
  const params = new URLSearchParams({ product_id: productId });
  if (basis) { params.set("quantity", String(basis.quantity)); params.set("transport_mode", basis.transport); }
  const { data, error: loadError, isLoading, isValidating, mutate } = useSWR<ReferencePriceResponse>(
    `/api/catalogue/reference-price?${params}`, fetchApi, { revalidateOnFocus: true },
  );
  const { data: history, error: historyError, isLoading: historyLoading, mutate: mutateHistory } = useSWR<ReferencePriceHistory>(
    showHistory ? `/api/catalogue/reference-price/history?product_id=${encodeURIComponent(productId)}&page=${historyPage}` : null,
    fetchApi,
  );
  const proposal = data?.proposal;
  const quantityInput = quantity ?? String(proposal?.quantity ?? "");
  const transportInput = transport ?? proposal?.transport_mode ?? "";
  const basisChanged = Boolean(proposal) && (
    Number(quantityInput.replace(",", ".")) !== proposal?.quantity || transportInput !== proposal?.transport_mode
  );

  function recalculate() {
    const value = Number(quantityInput.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0 || value > 999999999.999 || !transportInput) {
      setError("Précisez une quantité positive et le traitement du transport."); return;
    }
    setError(null); setSuccess(null);
    setBasis({ quantity: value, transport: transportInput });
    if (!basisChanged) void mutate();
  }

  async function save(action: Record<string, unknown>) {
    const initiatingGeneration = generation.current;
    setBusy(true); setError(null); setSuccess(null);
    try {
      await fetchApi("/api/catalogue/reference-price", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action, product_id: productId }),
      });
      if (generation.current !== initiatingGeneration) return;
      await mutate();
      if (generation.current !== initiatingGeneration) return;
      if (action.action === "validate") {
        setSuccess("Prix de référence validé. Les devis existants conservent leurs coûts.");
        setManual(false); setManualPrice(""); setJustification("");
      } else if (action.action === "withdraw") {
        setSuccess("Prix de référence retiré. Les devis existants conservent leurs coûts.");
      }
      if (action.action === "validate" || action.action === "withdraw") {
        void mutateHistory();
        onValidated?.();
      }
    } catch (caught) {
      if (generation.current !== initiatingGeneration) return;
      setError(caught instanceof Error ? caught.message : "Enregistrement impossible.");
      // Never leave a changed or expired proposal actionable after a conflict.
      void mutate();
    } finally { if (generation.current === initiatingGeneration) setBusy(false); }
  }

  function validate() {
    if (!proposal?.quantity || !proposal.transport_mode || basisChanged) return;
    const cents = manual ? parseEuroToCents(manualPrice) : null;
    if (manual && (cents === null || cents < 0 || !justification.trim())) {
      setError("Indiquez un prix positif ou nul et justifiez votre choix."); return;
    }
    void save({ action: "validate", quantity: proposal.quantity,
      transport_mode: proposal.transport_mode, fingerprint: proposal.fingerprint,
      ...(manual ? { manual_price_cents: cents, justification: justification.trim() } : {}),
    });
  }

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4 sm:p-5" aria-label="Prix de référence">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">Prix de référence</h2>
          <p className="text-sm text-muted-foreground">Moyenne des dernières offres comparables encore valables, une par fournisseur. Validité maximale : six mois, date de fin incluse.</p>
        </div>
        <Button variant="outline" size="md" disabled={busy || isValidating} onClick={() => void mutate()}>
          Actualiser la proposition
        </Button>
      </div>
      {isLoading ? <LoadingState label="Calcul de la proposition…" className="justify-start py-2" /> : null}
      {loadError ? <Alert variant="danger">{loadError instanceof Error ? loadError.message : "Impossible de charger la proposition."}</Alert> : null}
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}
      {proposal && !loadError ? <>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-sm font-medium text-foreground-secondary">Quantité de référence ({proposal.unit})
            <Input inputMode="decimal" value={quantityInput} disabled={busy}
              onChange={(event) => setQuantity(event.target.value)} placeholder="À préciser" />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1.5 text-sm font-medium text-foreground-secondary">Base de comparaison
            <NativeSelect value={transportInput} disabled={busy} onChange={(event) => setTransport(event.target.value)}>
              <option value="">Transport à préciser</option><option value="excluded">Hors transport</option><option value="included">Transport inclus</option>
            </NativeSelect>
          </label>
          <Button variant="outline" size="lg" disabled={busy || isValidating} onClick={recalculate}>Calculer la moyenne</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border-subtle bg-surface-subtle p-3">
            <p className="text-sm text-foreground-secondary">Référence actuelle{proposal.offer_count === 0 && proposal.current_price_cents !== null ? " · à actualiser" : ""}</p>
            <p className="text-xl font-semibold text-foreground">{proposal.current_price_cents === null ? "Prix de référence manquant" : `${formatEUR(proposal.current_price_cents)} / ${proposal.unit}`}</p>
            {data.latest_validation ? <p className="mt-1 text-xs text-muted-foreground">
              {data.latest_validation.mode === "average" ? "Moyenne validée" : "Choix manuel justifié"} le {new Date(data.latest_validation.validated_at).toLocaleString("fr-FR")}
            </p> : proposal.current_price_cents !== null ? <p className="mt-1 text-xs text-muted-foreground">Valeur antérieure conservée</p> : null}
            {data.can_validate && proposal.current_price_cents !== null ? (
              <Button ref={withdrawButton} variant="outline" className="mt-3" disabled={busy || isValidating} onClick={() => setWithdrawalTarget(proposal)}>
                Retirer le prix de référence
              </Button>
            ) : null}
          </div>
          <div className="rounded-lg border border-info-border bg-info-subtle p-3">
            <p className="text-sm text-foreground-secondary">Moyenne proposée · à valider</p>
            <p className="text-xl font-semibold text-foreground">{proposal.proposed_price_cents === null ? "Aucune offre comparable" : `${formatEUR(proposal.proposed_price_cents)} / ${proposal.unit}`}</p>
            <p className="mt-1 text-xs text-foreground-secondary">{proposal.offer_count === 1 ? "Une seule source" : `${proposal.offer_count} fournisseurs retenus`}</p>
          </div>
        </div>
        {basisChanged ? <p role="status" className="text-sm text-warning">La quantité ou le transport a changé : recalculez avant de valider.</p> : null}
        {proposal.dispersion_alert ? <Alert variant="warning" role="alert">
          Écart supérieur à 15 % : {proposal.dispersion_percent?.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} % entre le minimum et le maximum. Toutes les offres retenues restent dans la moyenne.
        </Alert> : null}
        {proposal.zero_price_requires_review ? <Alert variant="warning" role="alert">Une offre à prix nul est exclue de la moyenne et reste à clarifier. Valider la moyenne ne règle pas cette anomalie. Corrigez ou retirez l’offre concernée.</Alert> : null}
        <details className="rounded-lg border border-border p-3" open>
          <summary className="cursor-pointer rounded text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Offres retenues et exclues ({proposal.offers.length})</summary>
          <div className="relative mt-3 overflow-x-auto" role="region" aria-label="Offres retenues et exclues" tabIndex={0}>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground"><tr><th scope="col" className="p-2 font-semibold">Fournisseur / référence</th><th scope="col" className="p-2 font-semibold">Prix HT</th><th scope="col" className="p-2 font-semibold">Conditions</th><th scope="col" className="p-2 font-semibold">Calcul</th></tr></thead>
              <tbody>{proposal.offers.map((offer) => <tr key={offer.id} className="border-t border-border-subtle">
                <td className="p-2">{offer.supplier_name}<span className="block text-xs text-muted-foreground">{offer.supplier_sku ?? "Référence manquante"}</span></td>
                <td className="whitespace-nowrap p-2">{formatCurrencyCode(offer.unit_price_cents, offer.currency)} / {offer.unit}</td>
                <td className="p-2"><span className="block">Dès {offer.min_quantity} {offer.unit} · {offer.valid_from} → {offer.valid_to ?? "Fin non renseignée"}</span>
                  {data.can_validate ? <NativeSelect size="sm" wrapperClassName="mt-1 w-auto" aria-label={`Transport pour ${offer.supplier_name} (${offer.id})`}
                    value={offer.transport_mode ?? ""} disabled={busy || isValidating}
                    onChange={(event) => { void save({ action: "set-transport", offer_id: offer.id, transport_mode: event.target.value || null, expected_updated_at: offer.updated_at }); }}>
                    <option value="">Transport à préciser</option><option value="excluded">Hors transport</option><option value="included">Transport inclus</option>
                  </NativeSelect> : <span className="block">{transportLabel(offer.transport_mode)}</span>}
                </td>
                <td className={`p-2 ${offer.exclusion ? "text-muted-foreground" : "font-medium text-success"}`}>
                  {offer.exclusion ? exclusions[offer.exclusion] : "Retenue"}
                  {offer.exclusion === "zero_price" ? <Link
                    className="mt-1 block rounded text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    href={`/dashboard/prices?product_id=${encodeURIComponent(productId)}&supplier_id=${encodeURIComponent(offer.supplier_id)}`}
                  >Examiner l’offre à corriger</Link> : null}
                </td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
        {data.can_validate ? <div className="space-y-3 border-t border-border pt-3">
          <label className="flex min-h-9 items-center gap-2 text-sm text-foreground-secondary"><input type="checkbox" className="size-4 accent-primary" checked={manual} disabled={busy} onChange={(event) => setManual(event.target.checked)} />Choisir un prix manuel avec justification</label>
          {manual ? <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground-secondary">Prix choisi HT (€ / {proposal.unit})<Input value={manualPrice} inputMode="decimal" disabled={busy} onChange={(event) => setManualPrice(event.target.value)} /></label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground-secondary">Justification obligatoire<Textarea className="min-h-20" value={justification} maxLength={2000} disabled={busy} onChange={(event) => setJustification(event.target.value)} /></label>
          </div> : null}
          <Button size="lg" loading={busy} disabled={isValidating || basisChanged || !proposal.quantity || !proposal.transport_mode || (!manual && proposal.proposed_price_cents === null)} onClick={validate}>
            {manual ? "Valider le prix justifié" : "Valider la moyenne comme référence"}
          </Button>
          <p className="text-xs text-muted-foreground">La validation enregistre votre identité, la date et les offres examinées. Les coûts des devis existants restent inchangés.</p>
        </div> : <p className="text-sm text-muted-foreground">Un responsable autorisé doit valider la proposition.</p>}
      </> : null}
      <details className="rounded-lg border border-border" onToggle={(event) => setShowHistory(event.currentTarget.open)}>
        <summary className="cursor-pointer rounded p-3 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          Historique des prix de référence
        </summary>
        {showHistory ? (
          <div className="border-t border-border">
            {historyLoading ? <LoadingState label="Chargement de l’historique…" className="justify-start p-3" /> : null}
            {historyError ? <div className="p-3"><Alert variant="danger">Impossible de charger l’historique des prix de référence.</Alert></div> : null}
            {history?.events.length ? (
              <ol className="divide-y divide-border">
                {history.events.map((event) => <HistoryEntry key={event.id} event={event} />)}
              </ol>
            ) : history ? <p className="p-3 text-sm text-muted-foreground">Aucune décision enregistrée.</p> : null}
            {(historyPage > 1 || history?.has_more) ? (
              <div className="flex flex-wrap gap-2 border-t border-border p-3">
                <Button variant="outline" disabled={historyPage === 1} onClick={() => setHistoryPage(historyPage - 1)}>Page précédente</Button>
                <Button variant="outline" disabled={!history?.has_more} onClick={() => setHistoryPage(historyPage + 1)}>Page suivante</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </details>
      <AlertDialog open={withdrawalTarget !== null} onOpenChange={(open) => { if (!open) setWithdrawalTarget(null); }}>
        <AlertDialogContent finalFocus={withdrawButton}>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer le prix de référence ?</AlertDialogTitle>
            <AlertDialogDescription>
              {withdrawalTarget?.current_price_cents != null ? `Le prix de ${formatEUR(withdrawalTarget.current_price_cents)} / ${withdrawalTarget.unit} sera retiré. ` : ""}
              L’article affichera un prix de référence manquant. Les validations passées et les coûts des devis existants seront conservés.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <Button variant="danger-solid" size="lg" disabled={busy} onClick={() => {
              if (!withdrawalTarget) return;
              setWithdrawalTarget(null);
              void save({
                action: "withdraw", expected_updated_at: withdrawalTarget.product_updated_at,
                expected_validation_id: withdrawalTarget.validation_id,
              });
            }}>
              Confirmer le retrait
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
