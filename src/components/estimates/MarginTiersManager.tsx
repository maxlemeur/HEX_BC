"use client";

import { useMemo, useState } from "react";

import { parseEuroToCents } from "@/lib/money";
import type { Database } from "@/types/database";

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

  async function handleAdd() {
    setFormError(null);
    const thresholdCents = parseEuroToCents(newThreshold || "0") ?? 0;
    const multiplierValue = Number(newMultiplier);

    if (!Number.isFinite(thresholdCents) || thresholdCents < 0) {
      setFormError("Le seuil doit etre un montant positif.");
      return;
    }

    if (!Number.isFinite(multiplierValue) || multiplierValue < 0 || multiplierValue > 100) {
      setFormError("Le multiplicateur doit etre entre 0 et 100.");
      return;
    }

    const duplicate = tiers.some((t) => t.threshold_cents === thresholdCents);
    if (duplicate) {
      setFormError("Une tranche avec ce seuil existe deja.");
      return;
    }

    await onCreate({ threshold_cents: thresholdCents, multiplier: multiplierValue });
    setNewThreshold("");
    setNewMultiplier("");
  }

  async function handleBlur(tier: MarginTierRow) {
    const draft = mergedDrafts[tier.id];
    if (!draft) return;

    const thresholdCents = parseEuroToCents(draft.threshold || "0") ?? 0;
    const multiplierValue = Number(draft.multiplier);

    if (!Number.isFinite(thresholdCents) || thresholdCents < 0) return;
    if (!Number.isFinite(multiplierValue) || multiplierValue < 0 || multiplierValue > 100) return;

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
    setFormError(null);
    await onDelete(tierId);
  }

  return (
    <div className="dashboard-card p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            Tranches de marge
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Definir les multiplicateurs de marge selon le montant du projet.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error mt-4">
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
          {error}
        </div>
      )}

      {canEdit && (
        <div className="estimate-role-form mt-6 grid gap-4 sm:grid-cols-[1fr_180px_auto]">
          <div>
            <label className="form-label" htmlFor="new-tier-threshold">
              Seuil (EUR)
            </label>
            <input
              id="new-tier-threshold"
              className="form-input form-input--sm"
              type="number"
              step="0.01"
              min={0}
              value={newThreshold}
              onChange={(event) => setNewThreshold(event.target.value)}
              placeholder="0.00"
              disabled={isSaving}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="new-tier-multiplier">
              Multiplicateur
            </label>
            <input
              id="new-tier-multiplier"
              className="form-input form-input--sm"
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
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={handleAdd}
              disabled={isSaving}
            >
              Ajouter
            </button>
          </div>
        </div>
      )}

      {formError && (
        <p className="mt-3 text-sm text-[var(--error)]">{formError}</p>
      )}

      <div className="table-scroll mt-6">
        <table className="data-table">
          <thead>
            <tr>
              <th>Seuil (EUR)</th>
              <th>Multiplicateur</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sortedTiers.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 3 : 2}>
                  <div className="text-sm text-[var(--slate-500)]">
                    Aucune tranche definie.
                  </div>
                </td>
              </tr>
            ) : (
              sortedTiers.map((tier) => {
                const draft = mergedDrafts[tier.id] ?? {
                  threshold: formatThresholdInput(tier.threshold_cents),
                  multiplier: formatMultiplierInput(tier.multiplier),
                };
                return (
                  <tr key={tier.id}>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft.threshold}
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
                      <input
                        className="form-input form-input--sm"
                        type="number"
                        step="0.01"
                        min={0}
                        max={100}
                        value={draft.multiplier}
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
                        <button
                          className="btn btn-danger btn-sm"
                          type="button"
                          onClick={() => handleDelete(tier.id)}
                          disabled={isSaving}
                        >
                          Supprimer
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
