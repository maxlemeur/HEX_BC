"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCwIcon, UserPlusIcon } from "lucide-react";

import { useUserContext } from "@/components/UserContext";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection } from "@/components/layout/page-section";
import {
  fetchMembershipApi,
  formatMembershipDate,
  MemberIdentity,
  TenantRoleBadge,
  TenantRoleSelect,
  type TenantRole,
} from "@/components/memberships/membership-shared";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui-legacy/Toast";

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

const PAGE_TITLE = "Membres de l’organisation";
const SEARCH_DEBOUNCE_MS = 250;
const ERROR_TOAST_MS = 8000;

function describeCandidates(count: number) {
  if (count === 0) return "Aucun profil disponible pour cette recherche.";
  if (count === 1) return "1 profil disponible.";
  return `${count} profils disponibles.`;
}

export function MembershipsManager() {
  const { profile, tenantId } = useUserContext();
  const confirm = useConfirm();
  const toast = useToast();

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
  const latestRequestRef = useRef(0);

  const canManageMemberships = profile?.tenant_role === "admin";

  const selectedCandidate = useMemo(() => {
    return candidates.find((candidate) => candidate.id === selectedUserId) ?? null;
  }, [candidates, selectedUserId]);
  const candidateOptions = useMemo(
    () =>
      candidates.map((candidate) => ({
        value: candidate.id,
        label: candidate.work_email
          ? `${candidate.full_name} — ${candidate.work_email}`
          : candidate.full_name,
        keywords: [candidate.full_name, candidate.work_email ?? ""],
      })),
    [candidates]
  );

  // The first load keeps the full-page loading state; later loads (search, refresh, after an
  // action) only flag `isRefreshing`, so the search field stays mounted and keeps its focus.
  const loadMemberships = useCallback(
    async (searchValue: string) => {
      if (!canManageMemberships || !tenantId) {
        setIsLoading(false);
        return;
      }

      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;
      setIsRefreshing(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        if (searchValue.trim().length > 0) {
          params.set("search", searchValue.trim());
        }

        const query = params.toString();
        const data = await fetchMembershipApi<MembershipsResponse>(
          `/api/memberships${query ? `?${query}` : ""}`
        );
        if (requestId !== latestRequestRef.current) return;

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
        if (requestId !== latestRequestRef.current) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Impossible de charger les membres de l’organisation."
        );
      } finally {
        if (requestId === latestRequestRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [canManageMemberships, tenantId]
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => void loadMemberships(search),
      search ? SEARCH_DEBOUNCE_MS : 0
    );
    return () => window.clearTimeout(timer);
  }, [loadMemberships, search]);

  async function handleAddMembership(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedUserId) {
      toast.error({ title: "Sélectionnez un utilisateur à ajouter." });
      return;
    }

    setIsSubmitting(true);

    try {
      await fetchMembershipApi("/api/memberships", {
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
      toast.success({ title: "Membre ajouté." });
      await loadMemberships(search);
    } catch (submitError) {
      toast.error({
        title: "Impossible d’ajouter le membre",
        description: submitError instanceof Error ? submitError.message : undefined,
        durationMs: ERROR_TOAST_MS,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleChangeRole(membership: MembershipRecord, role: TenantRole) {
    if (membership.role === role) return;

    setUpdatingMembershipId(membership.id);

    try {
      await fetchMembershipApi(`/api/memberships/${membership.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role }),
      });

      toast.success({ title: "Rôle mis à jour." });
      await loadMemberships(search);
    } catch (updateError) {
      toast.error({
        title: "Impossible de modifier le rôle",
        description: updateError instanceof Error ? updateError.message : undefined,
        durationMs: ERROR_TOAST_MS,
      });
    } finally {
      setUpdatingMembershipId(null);
    }
  }

  async function handleDeleteMembership(membership: MembershipRecord) {
    const confirmed = await confirm({
      title: `Retirer ${membership.user_full_name} de l’organisation ?`,
      description:
        "Cette personne n’aura plus accès aux affaires ni aux devis de l’organisation. Vous pourrez l’ajouter de nouveau plus tard.",
      confirmLabel: "Retirer",
      tone: "danger",
    });
    if (!confirmed) return;

    setDeletingMembershipId(membership.id);

    try {
      await fetchMembershipApi(`/api/memberships/${membership.id}`, {
        method: "DELETE",
      });

      toast.success({ title: "Membre retiré de l’organisation." });
      await loadMemberships(search);
    } catch (deleteError) {
      toast.error({
        title: "Impossible de retirer le membre",
        description: deleteError instanceof Error ? deleteError.message : undefined,
        durationMs: ERROR_TOAST_MS,
      });
    } finally {
      setDeletingMembershipId(null);
    }
  }

  if (!tenantId) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title={PAGE_TITLE}
          description="Cette section n’est disponible que pour les comptes rattachés à une organisation."
        />
        <Alert variant="info">Aucune organisation active détectée.</Alert>
      </div>
    );
  }

  if (!canManageMemberships) {
    return (
      <div className="animate-fade-in">
        <PageHeader
          title={PAGE_TITLE}
          description="Gestion des membres réservée aux administrateurs de l’organisation."
        />
        <Alert variant="info">
          Vous n’avez pas les droits administrateur pour gérer les membres.
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={PAGE_TITLE} />
        <LoadingState label="Chargement des membres…" className="min-h-[300px]" />
      </div>
    );
  }

  const searchHint =
    search.trim().length < 2
      ? "Saisissez au moins 2 caractères pour rechercher des profils."
      : describeCandidates(candidates.length);

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={PAGE_TITLE}
        description={
          tenantName
            ? `Ajouter des membres à l’organisation « ${tenantName} » et gérer leurs rôles.`
            : "Ajouter des membres à l’organisation active et gérer leurs rôles."
        }
        actions={
          <Button
            variant="outline"
            size="lg"
            leftIcon={<RefreshCwIcon aria-hidden="true" />}
            loading={isRefreshing}
            onClick={() => void loadMemberships(search)}
          >
            Actualiser
          </Button>
        }
      />

      {error ? (
        <Alert variant="danger" className="mb-6">
          {error}
        </Alert>
      ) : null}

      <PageSection title="Ajouter un membre" className="mb-8">
        <form className="grid gap-4 sm:grid-cols-4" onSubmit={handleAddMembership}>
          <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
            <FieldLabel htmlFor="membership-search">Rechercher un utilisateur</FieldLabel>
            <Input
              id="membership-search"
              type="search"
              size="lg"
              autoComplete="off"
              placeholder="Nom ou email (2 caractères min.)"
              aria-describedby="membership-search-hint"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <FieldLabel htmlFor="membership-user">Utilisateur</FieldLabel>
            <Combobox
              id="membership-user"
              name="membership-user"
              placeholder="Sélectionner…"
              emptyMessage="Aucun profil trouvé."
              options={candidateOptions}
              value={selectedUserId}
              onValueChange={setSelectedUserId}
              isLoading={isRefreshing}
              required
              size="lg"
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <FieldLabel htmlFor="membership-role">Rôle</FieldLabel>
            <TenantRoleSelect
              id="membership-role"
              size="lg"
              value={selectedRole}
              onValueChange={setSelectedRole}
            />
          </div>

          <div className="flex flex-col gap-3 sm:col-span-4 sm:flex-row sm:items-center sm:justify-between">
            <p
              id="membership-search-hint"
              className="text-xs text-muted-foreground"
              aria-live="polite"
            >
              {searchHint}
            </p>
            <Button
              type="submit"
              size="lg"
              leftIcon={<UserPlusIcon aria-hidden="true" />}
              loading={isSubmitting}
              disabled={!selectedUserId}
            >
              Ajouter le membre
            </Button>
          </div>
        </form>

        {selectedCandidate ? (
          <p className="mt-4 rounded-control border border-border bg-surface-subtle p-3 text-xs text-foreground-secondary">
            Sélection : <span className="font-medium text-foreground">{selectedCandidate.full_name}</span>
            {selectedCandidate.work_email ? (
              <span className="break-all"> ({selectedCandidate.work_email})</span>
            ) : null}
          </p>
        ) : null}
      </PageSection>

      <PageSection title="Membres existants" flush>
        <div
          role="region"
          aria-label="Liste des membres de l’organisation"
          tabIndex={0}
          className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          <table className="data-table min-w-[44rem]">
            <thead>
              <tr>
                <th scope="col">Membre</th>
                <th scope="col">Rôle</th>
                <th scope="col">Par défaut</th>
                <th scope="col">Depuis</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {memberships.length === 0 ? (
                <EmptyTableRow
                  colSpan={5}
                  title="Aucun membre"
                  description="Recherchez un utilisateur ci-dessus pour l’ajouter à l’organisation."
                />
              ) : (
                memberships.map((membership) => {
                  const isSelf = membership.user_id === currentUserId;
                  const isUpdating = updatingMembershipId === membership.id;
                  const isDeleting = deletingMembershipId === membership.id;

                  return (
                    <tr key={membership.id}>
                      <td>
                        <MemberIdentity
                          fullName={membership.user_full_name}
                          email={membership.user_work_email}
                          isSelf={isSelf}
                        />
                      </td>
                      <td>
                        <div className="grid grid-cols-[7rem_10rem] items-center gap-2">
                          <TenantRoleBadge role={membership.role} />
                          <TenantRoleSelect
                            size="sm"
                            aria-label={`Rôle de ${membership.user_full_name}`}
                            value={membership.role}
                            disabled={isUpdating}
                            aria-busy={isUpdating || undefined}
                            onValueChange={(role) => void handleChangeRole(membership, role)}
                          />
                        </div>
                      </td>
                      <td>
                        {membership.is_default ? (
                          <Badge variant="success" size="sm">
                            Oui
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Non</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatMembershipDate(membership.created_at)}
                      </td>
                      <td className="text-right">
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">Votre accès</span>
                        ) : (
                          <Button
                            variant="danger"
                            size="sm"
                            loading={isDeleting}
                            aria-label={`Retirer ${membership.user_full_name} de l’organisation`}
                            onClick={() => void handleDeleteMembership(membership)}
                          >
                            Retirer
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </PageSection>
    </div>
  );
}
