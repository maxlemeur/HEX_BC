"use client";

import { useMemo, useState } from "react";

import { parseEuroToCents } from "@/lib/money";
import type { Database } from "@/types/database";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

type LaborRolesManagerProps = {
  roles: LaborRole[];
  isSaving: boolean;
  canManage?: boolean;
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
  canManage = true,
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
    if (!canManage || isSaving) return;
    setFormError(null);
    const trimmedName = newName.trim();
    const rateCents = parseEuroToCents(newRate || "0") ?? 0;

    if (!trimmedName) {
      setFormError("Le nom du rôle est obligatoire.");
      return;
    }

    await onCreate({ name: trimmedName, hourly_rate_cents: rateCents });
    setNewName("");
    setNewRate("");
  }

  async function handleBlur(role: LaborRole) {
    if (!canManage || isSaving) return;
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
    <Card className="p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            Rôles main-d&apos;œuvre
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Gérer les rôles MO disponibles pour vos chiffrages.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="estimate-role-form mt-6 grid gap-4 sm:grid-cols-[1fr_180px_auto]">
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor="new-role-name">Nom du rôle</FieldLabel>
          <Input
            id="new-role-name"
            disabled={!canManage || isSaving}
            size="sm"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Ex. : Chef d'équipe"
          />
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <FieldLabel htmlFor="new-role-rate">Taux horaire (EUR)</FieldLabel>
          <Input
            id="new-role-rate"
            disabled={!canManage || isSaving}
            size="sm"
            type="number"
            step="0.01"
            min={0}
            value={newRate}
            onChange={(event) => setNewRate(event.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="flex items-end">
          <Button
            variant="primary"
            size="md"
            onClick={handleAddRole}
            disabled={!canManage || isSaving}
          >
            Ajouter
          </Button>
        </div>
      </div>

      {formError && (
        <Alert variant="danger" className="mt-3">
          {formError}
        </Alert>
      )}

      <div
        className="table-scroll mt-6"
        role="region"
        aria-label="Rôles main-d'œuvre"
        tabIndex={0}
      >
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Rôle</th>
              <th scope="col">Taux horaire</th>
              <th scope="col">Actif</th>
            </tr>
          </thead>
          <tbody>
            {roles.length === 0 ? (
              <tr>
                <td colSpan={3}>
                  <div className="text-sm text-muted-foreground">
                    Aucun rôle défini.
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
                      <Input
                        size="sm"
                        value={draft.name}
                        aria-label={`Libellé du rôle ${role.name}`}
                        disabled={!canManage || isSaving}
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
                      <Input
                        size="sm"
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft.rate}
                        aria-label={`Taux horaire du rôle ${role.name} (EUR)`}
                        disabled={!canManage || isSaving}
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
                          className="accent-primary"
                          checked={draft.is_active}
                          aria-label={`Rôle ${role.name} actif`}
                          disabled={!canManage || isSaving}
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
                        <span aria-hidden="true">{draft.is_active ? "Actif" : "Inactif"}</span>
                      </label>
                    </td>
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
