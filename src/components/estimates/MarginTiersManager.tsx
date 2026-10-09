"use client";

import { useMemo, useState } from "react";

import { MarginTiersExplanation } from "@/components/estimates/MarginTiersExplanation";
import { parseLocalizedNumberInput } from "@/components/ui-legacy/NumberInput";
import { parseEuroToCents } from "@/lib/money";
import type { Database } from "@/types/database";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];

type MarginTiersManagerProps = {
  tiers: MarginTierRow[];
  isSaving: boolean;
  error: string | null;
  canEdit: boolean;
  onCreate: (payload: { threshold_cents: number; multiplier: number }) => Promise<void>;
  onUpdate: (id: string, updates: { threshold_cents?: number; multiplier?: number }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

type TierDraft = {
  threshold: string;
  multiplier: string;
};

function formatThresholdInput(cents: number) {
  if (!Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

function formatMultiplierInput(value: number) {
  if (!Number.isFinite(value)) return "";
  return String(value);
}

export function MarginTiersManager({
  tiers,
  isSaving,
  error,
  canEdit,
  onCreate,
  onUpdate,
  onDelete,
}: MarginTiersManagerProps) {
  const [drafts, setDrafts] = useState<Record<string, TierDraft>>({});
  const [newThreshold, setNewThreshold] = useState("");
  const [newMultiplier, setNewMultiplier] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => a.threshold_cents - b.threshold_cents),
    [tiers]
  );

  const mergedDrafts = useMemo(() => {
    const next = { ...drafts };
    sortedTiers.forEach((tier) => {
      if (!next[tier.id]) {
        next[tier.id] = {
          threshold: formatThresholdInput(tier.threshold_cents),
          multiplier: formatMultiplierInput(tier.multiplier),
        };
      }
    });
    return next;
  }, [drafts, sortedTiers]);

  function validateDraft(draft: TierDraft, tierId?: string) {
    const thresholdCents = parseEuroToCents(draft.threshold);
    const multiplierValue = parseLocalizedNumberInput(draft.multiplier);
    if (thresholdCents === null || thresholdCents < 0) {
      setFormError("Le seuil doit être un montant supérieur ou égal à zéro.");
      return null;
    }
    if (multiplierValue === null || multiplierValue < 0 || multiplierValue > 100) {
      setFormError("Le coefficient doit être renseigné entre 0 et 100.");
      return null;
    }
    if (tiers.some((tier) => tier.id !== tierId && tier.threshold_cents === thresholdCents)) {
      setFormError("Une tranche avec ce seuil existe déjà.");
      return null;
    }
    return { threshold_cents: thresholdCents, multiplier: multiplierValue };
  }

  async function handleAdd() {
    if (!canEdit || isSaving) return;
    setFormError(null);
    const values = validateDraft({ threshold: newThreshold, multiplier: newMultiplier });
    if (!values) return;
    await onCreate(values);
    setNewThreshold("");
    setNewMultiplier("");
  }

  async function handleBlur(tier: MarginTierRow) {
    if (!canEdit || isSaving) return;
    setFormError(null);
    const draft = mergedDrafts[tier.id];
    if (!draft) return;
    const values = validateDraft(draft, tier.id);
    if (!values) return;
    const { threshold_cents: thresholdCents, multiplier: multiplierValue } = values;

    const hasChanges =
      thresholdCents !== tier.threshold_cents ||
      multiplierValue !== tier.multiplier;

    if (!hasChanges) return;

    const updates: { threshold_cents?: number; multiplier?: number } = {};
    if (thresholdCents !== tier.threshold_cents) updates.threshold_cents = thresholdCents;
    if (multiplierValue !== tier.multiplier) updates.multiplier = multiplierValue;

    await onUpdate(tier.id, updates);
  }

  async function handleDelete(tierId: string) {
    if (!canEdit || isSaving) return;
    setFormError(null);
    await onDelete(tierId);
  }

  return (
    // `dashboard-card` stays as an e2e hook (demo-eight-parameters selects this card by it);
    // the trailing overrides cancel its legacy hover lift on this non-interactive card.
    <Card className="dashboard-card p-5 sm:p-8 hover:transform-none! hover:border-border! hover:shadow-card!">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            Tranches de marge
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Barème commun à votre organisation, paramétrable par un administrateur.
          </p>
          <MarginTiersExplanation tiers={tiers} />
          <p className="mt-2 text-xs text-muted-foreground">
            Les modifications s’appliquent aux chiffrages en cours utilisant ce
            barème. Les montants des devis figés sont conservés.
          </p>
          {!canEdit ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Consultation seule : la modification nécessite les droits
              administrateur et un devis modifiable.
            </p>
          ) : null}
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mt-4">
          {error}
        </Alert>
      )}

      {canEdit && (
        <div className="estimate-role-form mt-6 grid gap-4 sm:grid-cols-[1fr_180px_auto]">
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="new-tier-threshold">
              Seuil de coût HT (EUR)
            </FieldLabel>
            <Input
              id="new-tier-threshold"
              size="sm"
              type="number"
              step="0.01"
              min={0}
              value={newThreshold}
              onChange={(event) => setNewThreshold(event.target.value)}
              placeholder="0.00"
              disabled={isSaving}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="new-tier-multiplier">
              Coefficient
            </FieldLabel>
            <Input
              id="new-tier-multiplier"
              size="sm"
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={newMultiplier}
              onChange={(event) => setNewMultiplier(event.target.value)}
              placeholder="1.50"
              disabled={isSaving}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="primary"
              size="md"
              onClick={handleAdd}
              disabled={isSaving}
            >
              Ajouter
            </Button>
          </div>
        </div>
      )}

      {formError && (
        <Alert variant="danger" className="mt-3">
          {formError}
        </Alert>
      )}

      <div
        className="table-scroll mt-6"
        role="region"
        aria-label="Tranches de marge configurées"
        tabIndex={0}
      >
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Seuil de coût HT (EUR)</th>
              <th scope="col">Coefficient</th>
              {canEdit && <th scope="col">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sortedTiers.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 3 : 2}>
                  <div className="text-sm text-muted-foreground">
                    Aucune tranche définie : le barème par défaut est appliqué.
                  </div>
                </td>
              </tr>
            ) : (
              sortedTiers.map((tier) => {
                const draft = mergedDrafts[tier.id] ?? {
                  threshold: formatThresholdInput(tier.threshold_cents),
                  multiplier: formatMultiplierInput(tier.multiplier),
                };
                const tierLabel = `${formatThresholdInput(tier.threshold_cents)} EUR`;
                return (
                  <tr key={tier.id}>
                    <td>
                      <Input
                        size="sm"
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft.threshold}
                        aria-label={`Seuil de coût HT de la tranche ${tierLabel}`}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [tier.id]: {
                              ...draft,
                              threshold: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => handleBlur(tier)}
                        disabled={!canEdit || isSaving}
                      />
                    </td>
                    <td>
                      <Input
                        size="sm"
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        value={draft.multiplier}
                        aria-label={`Coefficient de la tranche ${tierLabel}`}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [tier.id]: {
                              ...draft,
                              multiplier: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => handleBlur(tier)}
                        disabled={!canEdit || isSaving}
                      />
                    </td>
                    {canEdit && (
                      <td>
                        <Button
                          variant="danger"
                          size="md"
                          aria-label={`Supprimer la tranche ${tierLabel}`}
                          onClick={() => handleDelete(tier.id)}
                          disabled={isSaving}
                        >
                          Supprimer
                        </Button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
