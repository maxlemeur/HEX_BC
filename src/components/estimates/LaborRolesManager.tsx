"use client";

import { useMemo, useState } from "react";

import { parseEuroToCents } from "@/lib/money";
import type { Database } from "@/types/database";

type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

type LaborRolesManagerProps = {
  roles: LaborRole[];
  isSaving: boolean;
  error: string | null;
  onCreate: (payload: { name: string; hourly_rate_cents: number }) => Promise<void>;
  onUpdate: (id: string, updates: Partial<LaborRole>) => Promise<void>;
};

type RoleDraft = {
  name: string;
  rate: string;
  is_active: boolean;
};

function formatRateInput(cents: number) {
  if (!Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

export function LaborRolesManager({
  roles,
  isSaving,
  error,
  onCreate,
  onUpdate,
}: LaborRolesManagerProps) {
  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({});
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mergedDrafts = useMemo(() => {
    const next = { ...drafts };
    roles.forEach((role) => {
      if (!next[role.id]) {
        next[role.id] = {
          name: role.name,
          rate: formatRateInput(role.hourly_rate_cents),
          is_active: role.is_active,
        };
      }
    });
    return next;
  }, [drafts, roles]);

  async function handleAddRole() {
    setFormError(null);
    const trimmedName = newName.trim();
    const rateCents = parseEuroToCents(newRate || "0") ?? 0;

    if (!trimmedName) {
      setFormError("Le nom du role est obligatoire.");
      return;
    }

    await onCreate({ name: trimmedName, hourly_rate_cents: rateCents });
    setNewName("");
    setNewRate("");
  }

  async function handleBlur(role: LaborRole) {
    const draft = mergedDrafts[role.id];
    if (!draft) return;

    const trimmedName = draft.name.trim();
    const rateCents = parseEuroToCents(draft.rate || "0") ?? 0;
    const hasChanges =
      trimmedName !== role.name ||
      rateCents !== role.hourly_rate_cents ||
      draft.is_active !== role.is_active;

    if (!hasChanges) return;

    await onUpdate(role.id, {
      name: trimmedName || role.name,
      hourly_rate_cents: rateCents,
      is_active: draft.is_active,
    });
  }

  return (
    <div className="dashboard-card p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            Roles main d&apos;oeuvre
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Gerer les roles MO disponibles pour vos chiffrages.
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

      <div className="estimate-role-form mt-6 grid gap-4 sm:grid-cols-[1fr_180px_auto]">
        <div>
          <label className="form-label" htmlFor="new-role-name">
            Nom du role
          </label>
          <input
            id="new-role-name"
            className="form-input form-input--sm"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Ex: Chef d'equipe"
          />
        </div>
        <div>
          <label className="form-label" htmlFor="new-role-rate">
            Taux horaire (EUR)
          </label>
          <input
            id="new-role-rate"
            className="form-input form-input--sm"
            type="number"
            step="0.01"
            min={0}
            value={newRate}
            onChange={(event) => setNewRate(event.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="flex items-end">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={handleAddRole}
            disabled={isSaving}
          >
            Ajouter
          </button>
        </div>
      </div>

      {formError && (
        <p className="mt-3 text-sm text-[var(--error)]">{formError}</p>
      )}

      <div className="table-scroll mt-6">
        <table className="data-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Taux horaire</th>
              <th>Actif</th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <div className="text-sm text-[var(--slate-500)]">
                    Aucun role defini.
                  </div>
                </td>
              </tr>
            ) : (
              roles.map((role) => {
                const draft = mergedDrafts[role.id] ?? {
                  name: role.name,
                  rate: formatRateInput(role.hourly_rate_cents),
                  is_active: role.is_active,
                };
                return (
                  <tr key={role.id}>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        value={draft.name}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [role.id]: {
                              ...draft,
                              name: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => handleBlur(role)}
                      />
                    </td>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft.rate}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [role.id]: {
                              ...draft,
                              rate: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => handleBlur(role)}
                      />
                    </td>
                    <td>
                      <label className="estimate-toggle">
                        <input
                          type="checkbox"
                          checked={draft.is_active}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [role.id]: {
                                ...draft,
                                is_active: event.target.checked,
                              },
                            }))
                          }
                          onBlur={() => handleBlur(role)}
                        />
                        <span>{draft.is_active ? "Actif" : "Inactif"}</span>
                      </label>
                    </td>
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
