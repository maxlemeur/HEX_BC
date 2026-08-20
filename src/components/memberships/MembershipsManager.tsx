"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useUserContext } from "@/components/UserContext";
import { Badge } from "@/components/ui-legacy/Badge";
import { SearchableSelect } from "@/components/ui-legacy/SearchableSelect";
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
  user_legacy_role: "buyer" | "site_manager" | "admin";
};

type CandidateRecord = {
  id: string;
  full_name: string;
  work_email: string | null;
  role: "buyer" | "site_manager" | "admin";
};

type MembershipsResponse = {
  tenant: {
    id: string;
    name: string;
    slug: string;
    is_active: boolean;
  };
  current_user_id: string;
  current_membership_role: TenantRole;
  memberships: MembershipRecord[];
  candidates: CandidateRecord[];
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

function roleBadgeVariant(role: TenantRole): "info" | "warning" | "neutral" | "success" {
  if (role === "admin") return "info";
  if (role === "engineer") return "warning";
  if (role === "director") return "success";
  return "neutral";
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

export function MembershipsManager() {
  const { profile, tenantId } = useUserContext();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingMembershipId, setUpdatingMembershipId] = useState<string | null>(null);
  const [deletingMembershipId, setDeletingMembershipId] = useState<string | null>(null);

  const [tenantName, setTenantName] = useState("");
  const [memberships, setMemberships] = useState<MembershipRecord[]>([]);
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<TenantRole>("engineer");

  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canManageMemberships = profile?.tenant_role === "admin";

  const selectedCandidate = useMemo(() => {
    return candidates.find((candidate) => candidate.id === selectedUserId) ?? null;
  }, [candidates, selectedUserId]);
  const candidateOptions = useMemo(
    () =>
      candidates.map((candidate) => ({
        value: candidate.id,
        label: candidate.work_email
          ? `${candidate.full_name} - ${candidate.work_email}`
          : candidate.full_name,
        keywords: [candidate.full_name, candidate.work_email ?? ""],
      })),
    [candidates]
  );

  const loadMemberships = useCallback(
    async (searchValue: string, options?: { initial?: boolean }) => {
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
        const params = new URLSearchParams();
        if (searchValue.trim().length > 0) {
          params.set("search", searchValue.trim());
        }

        const query = params.toString();
        const data = await fetchApi<MembershipsResponse>(
          `/api/memberships${query ? `?${query}` : ""}`
        );

        setTenantName(data.tenant.name);
        setMemberships(data.memberships);
        setCandidates(data.candidates);
        setCurrentUserId(data.current_user_id);

        setSelectedUserId((previousSelectedUserId) => {
          if (!previousSelectedUserId) return previousSelectedUserId;

          const stillExists = data.candidates.some(
            (candidate) => candidate.id === previousSelectedUserId
          );
          return stillExists ? previousSelectedUserId : "";
        });
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Impossible de charger les memberships."
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [canManageMemberships, tenantId]
  );

  useEffect(() => {
    void loadMemberships(search, { initial: true });
  }, [loadMemberships, search]);

  async function handleAddMembership(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedUserId) {
      setActionError("Selectionnez un utilisateur a ajouter.");
      return;
    }

    setActionError(null);
    setSuccess(null);
    setIsSubmitting(true);

    try {
      await fetchApi("/api/memberships", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: selectedUserId,
          role: selectedRole,
        }),
      });

      setSelectedUserId("");
      setSelectedRole("engineer");
      setSuccess("Membre ajoute avec succes.");
      await loadMemberships(search);
    } catch (submitError) {
      setActionError(
        submitError instanceof Error
          ? submitError.message
          : "Impossible d'ajouter le membre."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleChangeRole(membership: MembershipRecord, role: TenantRole) {
    if (membership.role === role) return;

    setActionError(null);
    setSuccess(null);
    setUpdatingMembershipId(membership.id);

    try {
      await fetchApi(`/api/memberships/${membership.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      });

      setSuccess("Role mis a jour avec succes.");
      await loadMemberships(search);
    } catch (updateError) {
      setActionError(
        updateError instanceof Error
          ? updateError.message
          : "Impossible de modifier le role."
      );
    } finally {
      setUpdatingMembershipId(null);
    }
  }

  async function handleDeleteMembership(membership: MembershipRecord) {
    const confirmed = window.confirm(
      `Supprimer ${membership.user_full_name} du tenant ?`
    );
    if (!confirmed) return;

    setActionError(null);
    setSuccess(null);
    setDeletingMembershipId(membership.id);

    try {
      await fetchApi(`/api/memberships/${membership.id}`, {
        method: "DELETE",
      });

      setSuccess("Membre supprime avec succes.");
      await loadMemberships(search);
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer le membre."
      );
    } finally {
      setDeletingMembershipId(null);
    }
  }

  if (!tenantId) {
    return (
      <div className="animate-fade-in">
        <div className="page-header">
          <h1 className="page-title">Membres du tenant</h1>
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
          <h1 className="page-title">Membres du tenant</h1>
          <p className="page-description">
            Gestion des membres reservee aux administrateurs du tenant.
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
      <div className="page-header flex items-start justify-between gap-6">
        <div>
          <h1 className="page-title">Membres du tenant</h1>
          <p className="page-description">
            Gerer les membres et roles du tenant {tenantName ? `"${tenantName}"` : "actif"}.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void loadMemberships(search)}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Actualisation..." : "Actualiser"}
        </button>
      </div>

      {error ? <div className="alert alert-error mb-6">{error}</div> : null}
      {actionError ? <div className="alert alert-error mb-6">{actionError}</div> : null}
      {success ? <div className="alert alert-success mb-6">{success}</div> : null}

      <div className="dashboard-card p-6 mb-8">
        <h2 className="text-sm font-semibold text-[var(--slate-800)] mb-4">
          Ajouter un membre
        </h2>

        <form className="grid gap-4 sm:grid-cols-4" onSubmit={handleAddMembership}>
          <div className="sm:col-span-2">
            <label className="form-label" htmlFor="membership-search">
              Rechercher un utilisateur
            </label>
            <input
              id="membership-search"
              className="form-input"
              placeholder="Nom ou email (min. 2 caracteres)"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div>
            <SearchableSelect
              id="membership-user"
              name="membership-user"
              label="Utilisateur"
              placeholder="Selectionner..."
              options={candidateOptions}
              value={selectedUserId}
              onValueChange={setSelectedUserId}
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="membership-role">
              Role tenant
            </label>
            <select
              id="membership-role"
              className="form-input"
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value as TenantRole)}
            >
              <option value="admin">Administrateur</option>
              <option value="engineer">Ingenieur</option>
              <option value="director">Directeur</option>
              <option value="viewer">Lecteur</option>
            </select>
          </div>

          <div className="sm:col-span-4 flex items-center justify-between gap-4">
            <p className="text-xs text-[var(--slate-500)]">
              {search.trim().length < 2
                ? "Saisissez au moins 2 caracteres pour rechercher des profils."
                : `${candidates.length} candidat(s) disponible(s).`}
            </p>
            <button className="btn btn-primary" type="submit" disabled={isSubmitting || !selectedUserId}>
              {isSubmitting ? "Ajout..." : "Ajouter"}
            </button>
          </div>
        </form>

        {selectedCandidate ? (
          <div className="mt-4 rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] p-3 text-xs text-[var(--slate-600)]">
            Ajout en cours: <span className="font-medium">{selectedCandidate.full_name}</span>
            {selectedCandidate.work_email ? ` (${selectedCandidate.work_email})` : ""}
          </div>
        ) : null}
      </div>

      <div className="dashboard-card overflow-hidden">
        <div className="border-b border-[var(--slate-200)] px-6 py-4">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">Membres existants</h2>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Membre</th>
                <th>Role tenant</th>
                <th>Par defaut</th>
                <th>Depuis</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {memberships.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[var(--slate-500)]">
                    Aucun membership.
                  </td>
                </tr>
              ) : (
                memberships.map((membership) => {
                  const isSelf = membership.user_id === currentUserId;
                  const isUpdating = updatingMembershipId === membership.id;
                  const isDeleting = deletingMembershipId === membership.id;

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
                      <td>
                        <div className="flex items-center gap-2">
                          <Badge variant={roleBadgeVariant(membership.role)} size="sm">
                            {ROLE_LABELS[membership.role]}
                          </Badge>
                          <select
                            className="form-input form-input--sm max-w-[170px]"
                            value={membership.role}
                            disabled={isUpdating}
                            onChange={(event) =>
                              void handleChangeRole(
                                membership,
                                event.target.value as TenantRole
                              )
                            }
                          >
                            <option value="admin">Administrateur</option>
                            <option value="engineer">Ingenieur</option>
                            <option value="director">Directeur</option>
                            <option value="viewer">Lecteur</option>
                          </select>
                        </div>
                      </td>
                      <td>
                        {membership.is_default ? (
                          <Badge variant="success" size="sm">
                            Oui
                          </Badge>
                        ) : (
                          <span className="text-xs text-[var(--slate-500)]">Non</span>
                        )}
                      </td>
                      <td className="text-sm text-[var(--slate-500)]">
                        {formatDate(membership.created_at)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => void handleDeleteMembership(membership)}
                          disabled={isDeleting || isSelf}
                          title={
                            isSelf
                              ? "Vous ne pouvez pas supprimer votre propre membership"
                              : undefined
                          }
                        >
                          {isDeleting ? "Suppression..." : "Supprimer"}
                        </button>
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
