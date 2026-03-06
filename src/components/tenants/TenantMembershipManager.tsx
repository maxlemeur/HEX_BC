"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useUserContext } from "@/components/UserContext";
import type { Database } from "@/types/database";

type TenantRole = Database["public"]["Enums"]["tenant_role"];

type MembershipRecord = {
  id: string;
  user_id: string;
  role: TenantRole;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  user_full_name: string;
  user_work_email: string | null;
  user_job_title: string | null;
};

type TenantMembershipsResponse = {
  tenant: {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
  };
  current_user_id: string;
  memberships: MembershipRecord[];
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
  };
};

const ROLE_LABELS: Record<TenantRole, string> = {
  admin: "Administrateur",
  engineer: "Ingenieur",
  viewer: "Lecteur",
  director: "Directeur",
};

function roleBadgeClass(role: TenantRole) {
  if (role === "admin") {
    return "inline-flex items-center rounded-full bg-[var(--brand-blue)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--brand-blue)]";
  }

  if (role === "engineer") {
    return "inline-flex items-center rounded-full bg-[var(--warning-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--warning)]";
  }

  if (role === "director") {
    return "inline-flex items-center rounded-full bg-[var(--success)]/10 px-2.5 py-0.5 text-xs font-medium text-[var(--success)]";
  }

  return "inline-flex items-center rounded-full bg-[var(--slate-100)] px-2.5 py-0.5 text-xs font-medium text-[var(--slate-600)]";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function resolveErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return fallback;
  }

  const envelope = payload as ApiEnvelope<unknown>;
  return envelope.error?.message ?? fallback;
}

async function fetchApi<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "same-origin",
    ...init,
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(resolveErrorMessage(payload, "Une erreur est survenue."));
  }

  const envelope = payload as ApiEnvelope<T>;
  if (envelope?.data !== undefined) {
    return envelope.data;
  }

  return payload as T;
}

export function TenantMembershipManager() {
  const { profile, tenantId } = useUserContext();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [updatingMembershipId, setUpdatingMembershipId] = useState<string | null>(null);

  const [tenantName, setTenantName] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<MembershipRecord[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canManageMemberships = profile?.tenant_role === "admin";

  const ownMembership = useMemo(() => {
    if (!currentUserId) {
      return null;
    }

    return memberships.find((membership) => membership.user_id === currentUserId) ?? null;
  }, [currentUserId, memberships]);

  const isCurrentTenantDefault = ownMembership?.is_default ?? false;

  const loadMemberships = useCallback(async (options?: { initial?: boolean }) => {
    if (!canManageMemberships || !tenantId) {
      setIsLoading(false);
      return;
    }

    if (options?.initial) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }

    setError(null);

    try {
      const data = await fetchApi<TenantMembershipsResponse>("/api/tenants/memberships");

      setTenantName(data.tenant.name);
      setCurrentUserId(data.current_user_id);
      setMemberships(data.memberships);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les memberships du tenant."
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [canManageMemberships, tenantId]);

  useEffect(() => {
    void loadMemberships({ initial: true });
  }, [loadMemberships]);

  async function handleChangeRole(membership: MembershipRecord, role: TenantRole) {
    if (membership.role === role) return;

    setActionError(null);
    setSuccess(null);
    setUpdatingMembershipId(membership.id);

    try {
      await fetchApi("/api/tenants/memberships", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "set-role",
          membership_id: membership.id,
          role,
        }),
      });

      setSuccess("Role mis a jour avec succes.");
      await loadMemberships();
    } catch (updateError) {
      setActionError(
        updateError instanceof Error
          ? updateError.message
          : "Impossible de modifier le role du membre."
      );
    } finally {
      setUpdatingMembershipId(null);
    }
  }

  async function handleSetDefault() {
    if (!ownMembership) {
      setActionError("Votre membership dans ce tenant est introuvable.");
      return;
    }

    setActionError(null);
    setSuccess(null);
    setIsSettingDefault(true);

    try {
      await fetchApi("/api/tenants/memberships", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "set-default",
          membership_id: ownMembership.id,
        }),
      });

      setSuccess("Tenant par defaut mis a jour.");
      await loadMemberships();
    } catch (defaultError) {
      setActionError(
        defaultError instanceof Error
          ? defaultError.message
          : "Impossible de mettre a jour le tenant par defaut."
      );
    } finally {
      setIsSettingDefault(false);
    }
  }

  if (!tenantId) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Tenant et membres</h1>
          <p className="page-description">
            Cette section n&apos;est disponible que pour les comptes rattaches a un tenant.
          </p>
        </div>

        <div className="alert alert-info">Aucun tenant actif detecte.</div>
      </div>
    );
  }

  if (!canManageMemberships) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Tenant et membres</h1>
          <p className="page-description">
            Gestion reservee aux administrateurs du tenant courant.
          </p>
        </div>

        <div className="alert alert-info">
          Vous n&apos;avez pas les droits administrateur pour gerer les memberships.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in flex min-h-[400px] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
          <span className="text-[var(--slate-500)]">Chargement...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Tenant et membres</h1>
          <p className="page-description">
            Gerer les roles du tenant {tenantName ? `"${tenantName}"` : "courant"}.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void loadMemberships()}
            disabled={isRefreshing}
          >
            {isRefreshing ? "Actualisation..." : "Actualiser"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSetDefault()}
            disabled={isSettingDefault || isCurrentTenantDefault || !ownMembership}
            title={isCurrentTenantDefault ? "Ce tenant est deja votre tenant par defaut." : undefined}
          >
            {isSettingDefault
              ? "Mise a jour..."
              : isCurrentTenantDefault
                ? "Tenant par defaut"
                : "Definir par defaut"}
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-error mb-6">{error}</div> : null}
      {actionError ? <div className="alert alert-error mb-6">{actionError}</div> : null}
      {success ? <div className="alert alert-success mb-6">{success}</div> : null}

      <div className="dashboard-card p-6 mb-8">
        <h2 className="text-sm font-semibold text-[var(--slate-800)] mb-2">Tenant courant</h2>
        <div className="text-sm text-[var(--slate-600)] space-y-1">
          <p>
            <span className="font-medium text-[var(--slate-800)]">Nom:</span> {tenantName || "-"}
          </p>
          <p>
            <span className="font-medium text-[var(--slate-800)]">Votre membership:</span>{" "}
            {ownMembership ? ROLE_LABELS[ownMembership.role] : "-"}
          </p>
          <p>
            <span className="font-medium text-[var(--slate-800)]">Statut par defaut:</span>{" "}
            {isCurrentTenantDefault ? "Oui" : "Non"}
          </p>
        </div>
      </div>

      <div className="dashboard-card overflow-hidden">
        <div className="border-b border-[var(--slate-200)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">Membres du tenant</h2>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Membre</th>
                <th>Fonction</th>
                <th>Role tenant</th>
                <th>Par defaut</th>
                <th>Depuis</th>
              </tr>
            </thead>
            <tbody>
              {memberships.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[var(--slate-500)]">
                    Aucun membership dans ce tenant.
                  </td>
                </tr>
              ) : (
                memberships.map((membership) => {
                  const isUpdating = updatingMembershipId === membership.id;
                  const isSelf = membership.user_id === currentUserId;

                  return (
                    <tr key={membership.id}>
                      <td>
                        <div className="flex flex-col">
                          <span className="font-medium text-[var(--slate-800)]">
                            {membership.user_full_name}
                          </span>
                          {membership.user_work_email ? (
                            <span className="text-xs text-[var(--slate-500)]">
                              {membership.user_work_email}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-sm text-[var(--slate-600)]">
                        {membership.user_job_title || "-"}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className={roleBadgeClass(membership.role)}>
                            {ROLE_LABELS[membership.role]}
                          </span>
                          <select
                            className="form-input form-input--sm max-w-[170px]"
                            value={membership.role}
                            disabled={isUpdating}
                            onChange={(event) =>
                              void handleChangeRole(membership, event.target.value as TenantRole)
                            }
                          >
                            <option value="admin">Administrateur</option>
                            <option value="engineer">Ingenieur</option>
                            <option value="director">Directeur</option>
                            <option value="viewer">Lecteur</option>
                          </select>
                        </div>
                        {isSelf ? (
                          <p className="mt-1 text-xs text-[var(--slate-500)]">Vous</p>
                        ) : null}
                      </td>
                      <td>
                        {membership.is_default ? (
                          <span className="inline-flex items-center rounded-full bg-[var(--success-light)] px-2.5 py-0.5 text-xs font-medium text-[var(--success)]">
                            Oui
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--slate-500)]">Non</span>
                        )}
                      </td>
                      <td className="text-sm text-[var(--slate-500)]">
                        {formatDate(membership.created_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
