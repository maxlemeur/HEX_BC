"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { fetchApi } from "@/components/catalogue/api";
import { formatEUR, parseEuroToCents } from "@/lib/money";
import type { ReferencePriceResponse } from "@/lib/catalogue/reference-price-schemas";

const exclusions: Record<string, string> = {
  inactive: "Offre ou fournisseur inactif", missing_supplier_reference: "Référence fournisseur manquante",
  future: "Pas encore valable", expired: "Expirée ou âgée de six mois",
  missing_quantity: "Quantité de référence à préciser", quantity: "Quantité minimale trop élevée",
  unit: "Unité différente", currency: "Devise différente", missing_transport: "Transport à préciser",
  transport: "Traitement du transport différent", zero_price: "Prix nul à vérifier",
  older_supplier_offer: "Offre plus récente retenue pour ce fournisseur",
};

function transportLabel(mode: string | null) {
  return mode === "included" ? "Transport inclus" : mode === "excluded" ? "Hors transport" : "À préciser";
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const generation = useRef(0);
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
    <section className="space-y-4 rounded-xl border border-border bg-surface p-5" aria-label="Prix de référence">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Prix de référence</h2>
          <p className="text-sm text-muted-foreground">Moyenne des dernières offres comparables de moins de six mois, une par fournisseur.</p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || isValidating} onClick={() => void mutate()}>Actualiser la proposition</button>
      </div>
      {isLoading ? <p role="status">Calcul de la proposition…</p> : null}
      {loadError ? <p role="alert" className="alert alert-error">{loadError instanceof Error ? loadError.message : "Impossible de charger la proposition."}</p> : null}
      {error ? <p role="alert" className="alert alert-error">{error}</p> : null}
      {success ? <p role="status" className="alert alert-success">{success}</p> : null}
      {proposal && !loadError ? <>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-40 flex-1 text-sm">Quantité de référence ({proposal.unit})
            <input className="form-input mt-1" inputMode="decimal" value={quantityInput} disabled={busy}
              onChange={(event) => setQuantity(event.target.value)} placeholder="À préciser" />
          </label>
          <label className="min-w-40 flex-1 text-sm">Base de comparaison
            <select className="form-input mt-1" value={transportInput} disabled={busy} onChange={(event) => setTransport(event.target.value)}>
              <option value="">Transport à préciser</option><option value="excluded">Hors transport</option><option value="included">Transport inclus</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary" disabled={busy || isValidating} onClick={recalculate}>Calculer la moyenne</button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-surface-subtle p-3">
            <p className="text-sm">Référence actuelle{proposal.offer_count === 0 && proposal.current_price_cents !== null ? " · à actualiser" : ""}</p>
            <p className="text-xl font-semibold">{proposal.current_price_cents === null ? "Prix manquant" : `${formatEUR(proposal.current_price_cents)} / ${proposal.unit}`}</p>
            {data.latest_validation ? <p className="mt-1 text-xs text-muted-foreground">
              {data.latest_validation.mode === "average" ? "Moyenne validée" : "Choix manuel justifié"} le {new Date(data.latest_validation.validated_at).toLocaleString("fr-FR")}
            </p> : <p className="mt-1 text-xs text-muted-foreground">Valeur antérieure conservée</p>}
          </div>
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-sm">Moyenne proposée · à valider</p>
            <p className="text-xl font-semibold">{proposal.zero_price_requires_review ? "Prix nul à vérifier" : proposal.proposed_price_cents === null ? "Aucune offre comparable" : `${formatEUR(proposal.proposed_price_cents)} / ${proposal.unit}`}</p>
            <p className="mt-1 text-xs">{proposal.offer_count === 1 ? "Une seule source" : `${proposal.offer_count} fournisseurs retenus`}</p>
          </div>
        </div>
        {basisChanged ? <p role="status" className="text-sm text-amber-800">La quantité ou le transport a changé : recalculez avant de valider.</p> : null}
        {proposal.dispersion_alert ? <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Écart supérieur à 15 % : {proposal.dispersion_percent?.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} % entre le minimum et le maximum. Toutes les offres retenues restent dans la moyenne.
        </p> : null}
        {proposal.zero_price_requires_review ? <p role="alert" className="text-sm text-amber-800">Une offre à prix nul nécessite une vérification. Aucune moyenne ne peut être validée avant traitement de cette anomalie.</p> : null}
        <details className="rounded-lg border border-border p-3" open>
          <summary className="cursor-pointer text-sm font-semibold">Offres retenues et exclues ({proposal.offers.length})</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr><th className="p-2">Fournisseur / référence</th><th className="p-2">Prix HT</th><th className="p-2">Conditions</th><th className="p-2">Calcul</th></tr></thead>
              <tbody>{proposal.offers.map((offer) => <tr key={offer.id} className="border-t border-border-subtle">
                <td className="p-2">{offer.supplier_name}<span className="block text-xs text-muted-foreground">{offer.supplier_sku ?? "Référence manquante"}</span></td>
                <td className="whitespace-nowrap p-2">{(offer.unit_price_cents / 100).toLocaleString("fr-FR", { style: "currency", currency: offer.currency })} / {offer.unit}</td>
                <td className="p-2"><span className="block">Dès {offer.min_quantity} {offer.unit} · {offer.valid_from} → {offer.valid_to ?? "Fin non renseignée"}</span>
                  {data.can_validate ? <select className="mt-1 rounded border border-border p-1" aria-label={`Transport pour ${offer.supplier_name} (${offer.id})`}
                    value={offer.transport_mode ?? ""} disabled={busy || isValidating}
                    onChange={(event) => { void save({ action: "set-transport", offer_id: offer.id, transport_mode: event.target.value || null, expected_updated_at: offer.updated_at }); }}>
                    <option value="">Transport à préciser</option><option value="excluded">Hors transport</option><option value="included">Transport inclus</option>
                  </select> : <span className="block">{transportLabel(offer.transport_mode)}</span>}
                </td>
                <td className={`p-2 ${offer.exclusion ? "text-muted-foreground" : "font-medium text-emerald-700"}`}>{offer.exclusion ? exclusions[offer.exclusion] : "Retenue"}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </details>
        {data.can_validate ? <div className="space-y-3 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={manual} disabled={busy} onChange={(event) => setManual(event.target.checked)} />Choisir un prix manuel avec justification</label>
          {manual ? <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Prix choisi HT (€ / {proposal.unit})<input className="form-input mt-1" value={manualPrice} inputMode="decimal" disabled={busy} onChange={(event) => setManualPrice(event.target.value)} /></label>
            <label className="text-sm">Justification obligatoire<textarea className="form-input mt-1" value={justification} maxLength={2000} disabled={busy} onChange={(event) => setJustification(event.target.value)} /></label>
          </div> : null}
          <button type="button" className="btn btn-primary" disabled={busy || isValidating || basisChanged || !proposal.quantity || !proposal.transport_mode || (!manual && proposal.proposed_price_cents === null)} onClick={validate}>
            {busy ? "Enregistrement…" : manual ? "Valider le prix justifié" : "Valider la moyenne comme référence"}
          </button>
          <p className="text-xs text-muted-foreground">La validation enregistre votre identité, la date et les offres examinées. Les coûts des devis existants restent inchangés.</p>
        </div> : <p className="text-sm text-muted-foreground">Un responsable autorisé doit valider la proposition.</p>}
      </> : null}
    </section>
  );
}
