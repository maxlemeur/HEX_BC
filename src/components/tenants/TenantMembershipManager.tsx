"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";

import { useUserContext } from "@/components/UserContext";
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

const PAGE_TITLE = "Organisation et membres";
const ERROR_TOAST_MS = 8000;

export function TenantMembershipManager() {
  const { profile, tenantId } = useUserContext();
  const toast = useToast();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [updatingMembershipId, setUpdatingMembershipId] = useState<string | null>(null);

  const [tenantName, setTenantName] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<MembershipRecord[]>([]);

  const [error, setError] = useState<string | null>(null);

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
      const data = await fetchMembershipApi<TenantMembershipsResponse>("/api/tenants/memberships");

      setTenantName(data.tenant.name);
      setCurrentUserId(data.current_user_id);
      setMemberships(data.memberships);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les membres de l’organisation."
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

    setUpdatingMembershipId(membership.id);

    try {
      await fetchMembershipApi("/api/tenants/memberships", {
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

      toast.success({ title: "Rôle mis à jour." });
      await loadMemberships();
    } catch (updateError) {
      toast.error({
        title: "Impossible de modifier le rôle du membre",
        description: updateError instanceof Error ? updateError.message : undefined,
        durationMs: ERROR_TOAST_MS,
      });
    } finally {
      setUpdatingMembershipId(null);
    }
  }

  async function handleSetDefault() {
    if (!ownMembership) {
      toast.error({ title: "Votre accès à cette organisation est introuvable." });
      return;
    }

    setIsSettingDefault(true);

    try {
      await fetchMembershipApi("/api/tenants/memberships", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "set-default",
          membership_id: ownMembership.id,
        }),
      });

      toast.success({ title: "Organisation par défaut mise à jour." });
      await loadMemberships();
    } catch (defaultError) {
      toast.error({
        title: "Impossible de définir l’organisation par défaut",
        description: defaultError instanceof Error ? defaultError.message : undefined,
        durationMs: ERROR_TOAST_MS,
      });
    } finally {
      setIsSettingDefault(false);
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
          description="Gestion réservée aux administrateurs de l’organisation courante."
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
        <LoadingState label="Chargement de l’organisation…" className="min-h-[300px]" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={PAGE_TITLE}
        description={
          tenantName
            ? `Gérer les rôles des membres de l’organisation « ${tenantName} ».`
            : "Gérer les rôles des membres de l’organisation courante."
        }
        actions={
          <Button
            variant="outline"
            size="lg"
            leftIcon={<RefreshCwIcon aria-hidden="true" />}
            loading={isRefreshing}
            onClick={() => void loadMemberships()}
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

      <PageSection
        title="Organisation courante"
        className="mb-8"
        actions={
          isCurrentTenantDefault ? undefined : (
            <Button
              variant="secondary"
              loading={isSettingDefault}
              disabled={!ownMembership}
              onClick={() => void handleSetDefault()}
            >
              Définir par défaut
            </Button>
          )
        }
      >
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">Nom</dt>
            <dd className="mt-1 break-words font-medium text-foreground">{tenantName || "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">Votre rôle</dt>
            <dd className="mt-1">
              {ownMembership ? <TenantRoleBadge role={ownMembership.role} /> : "—"}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium text-muted-foreground">Organisation par défaut</dt>
            <dd className="mt-1 text-foreground">{isCurrentTenantDefault ? "Oui" : "Non"}</dd>
          </div>
        </dl>
      </PageSection>

      <PageSection title="Membres de l’organisation" flush>
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
                <th scope="col">Fonction</th>
                <th scope="col">Rôle</th>
                <th scope="col">Par défaut</th>
                <th scope="col">Depuis</th>
              </tr>
            </thead>
            <tbody>
              {memberships.length === 0 ? (
                <EmptyTableRow
                  colSpan={5}
                  title="Aucun membre dans cette organisation"
                />
              ) : (
                memberships.map((membership) => {
                  const isUpdating = updatingMembershipId === membership.id;
                  const isSelf = membership.user_id === currentUserId;

                  return (
                    <tr key={membership.id}>
                      <td>
                        <MemberIdentity
                          fullName={membership.user_full_name}
                          email={membership.user_work_email}
                          isSelf={isSelf}
                        />
                      </td>
                      <td className="text-sm text-foreground-secondary">
                        {membership.user_job_title || "—"}
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
