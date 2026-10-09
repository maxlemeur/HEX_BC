"use client";

import { Fragment, useRef, useState } from "react";
import {
  BoxesIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  PencilIcon,
  Trash2Icon,
  TypeIcon,
} from "lucide-react";

import { EmptyTableRow } from "@/components/layout/empty-state";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  EstimateAssemblyDetail,
  EstimateAssemblyLaborRole,
  EstimateAssemblySummary,
} from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";

type AssemblyLibraryTableProps = {
  assemblies: EstimateAssemblySummary[];
  busyAssemblyId: string | null;
  laborRoles: EstimateAssemblyLaborRole[];
  refreshedAssemblies?: Readonly<Record<string, EstimateAssemblyDetail>>;
  onEdit: (assembly: EstimateAssemblySummary) => void;
  onRename: (assembly: EstimateAssemblySummary) => void;
  onDuplicate: (assembly: EstimateAssemblySummary) => void;
  onDelete: (assembly: EstimateAssemblySummary) => void;
  loadAssembly: (assemblyId: string) => Promise<EstimateAssemblyDetail>;
};

function formatDate(dateIso: string) {
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatNumber(value: number | null | undefined, fallback = "-") {
  if (value === null || value === undefined) return fallback;
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
}
function formatCurrency(cents: number | null | undefined) {
  return formatEUR(cents ?? 0);
}

function computePreviewMetrics(
  detail: EstimateAssemblyDetail,
  laborRoles: EstimateAssemblyLaborRole[],
) {
  let directCostCents = 0;
  let laborHours = 0;

  detail.items.forEach((item) => {
    const quantity = Math.max(item.default_quantity ?? 0, 0);
    const unitCostCents = Math.max(item.unit_cost_ht_cents ?? 0, 0);
    const isLabor = (item.cost_type ?? "material") === "labor";
    const itemLaborHours = Math.max(
      item.h_mo ?? (isLabor ? quantity : 0),
      0,
    );
    const supplyCostCents = isLabor
      ? 0
      : quantity * unitCostCents * Math.max(item.k_fo ?? 1, 0);
    const laborRateCents =
      laborRoles.find((role) => role.id === item.labor_role_id)
        ?.hourly_rate_cents ?? (isLabor ? unitCostCents : 0);
    const laborCostCents =
      itemLaborHours * laborRateCents * Math.max(item.k_mo ?? 1, 0);

    directCostCents += Math.round(supplyCostCents + laborCostCents);
    laborHours += itemLaborHours;
  });

  (detail.members ?? []).forEach((member) => {
    const quantity = Math.max(member.quantity, 0);
    const child = member.child_assembly;
    if (!child) return;
    directCostCents += Math.round(quantity * child.ds_cents);
    laborHours += quantity * (child.avg_time_hours ?? 0);
  });

  return {
    directCostCents,
    laborHours,
  };
}

function formatCostType(value: EstimateAssemblyDetail["items"][number]["cost_type"]) {
  switch (value) {
    case "labor":
      return "Main-d’œuvre";
    case "equipment":
      return "Matériel";
    case "subcontract":
      return "Sous-traitance";
    default:
      return "Fourniture";
  }
}

function formatLineCount(count: number) {
  return count + " " + (count === 1 ? "ligne" : "lignes");
}

function formatContentCount(lineCount: number, memberCount: number) {
  const members =
    memberCount +
    " " +
    (memberCount === 1 ? "sous-ouvrage" : "sous-ouvrages");
  return `${formatLineCount(lineCount)} · ${members}`;
}

function formatLegacyGeneratedText(value: string) {
  return value
    .replace(
      /^Ouvrage compose genere depuis /,
      "Ouvrage composé généré depuis ",
    )
    .replace(/^Main d'oeuvre - /, "Main-d’œuvre – ")
    .replace(/^Materiel de pose - /, "Matériel de pose – ");
}

type AssemblyContentPreviewProps = {
  assembly: EstimateAssemblySummary;
  detail: EstimateAssemblyDetail | undefined;
  laborRoles: EstimateAssemblyLaborRole[];
  isLoading: boolean;
  error: string | undefined;
  onRetry: () => void;
};

function AssemblyContentPreview({
  assembly,
  laborRoles,
  detail,
  isLoading,
  error,
  onRetry,
}: AssemblyContentPreviewProps) {
  const metrics = detail ? computePreviewMetrics(detail, laborRoles) : null;

  return (
    <div className="ml-9">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Contenu de l&apos;ouvrage
        </p>
        <Badge variant="outline">
          {formatContentCount(
            detail?.items.length ?? assembly.itemCount,
            detail?.members?.length ?? assembly.memberCount ?? 0
          )}
        </Badge>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <span className="text-xs text-muted-foreground">Référence</span>
          <p className="mt-0.5 font-mono text-sm font-semibold text-foreground">
            {detail?.referenceCode ?? assembly.referenceCode ?? assembly.id.slice(0, 8)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <span className="text-xs text-muted-foreground">Coût direct</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {formatCurrency(metrics?.directCostCents ?? assembly.directCostCents)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <span className="text-xs text-muted-foreground">Temps MO total</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {formatNumber(metrics?.laborHours ?? assembly.averageTimeHours, "0")} h
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <span className="text-xs text-muted-foreground">Prix cible</span>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {formatCurrency(
              detail?.targetPriceCents ?? assembly.targetPriceCents
            )}
          </p>
        </div>
      </div>

      {!isLoading && !error && detail?.members?.length ? (
        <div
          className="relative mb-3 overflow-x-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          role="region"
          aria-label={`Sous-ouvrages de ${assembly.name}`}
          tabIndex={0}
        >
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5">Sous-ouvrage</th>
                <th className="px-4 py-2.5">Référence</th>
                <th className="px-4 py-2.5">Quantité</th>
                <th className="px-4 py-2.5 text-right">Coût intégré</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {[...detail.members]
                .sort((first, second) => first.position - second.position)
                .map((member) => (
                  <tr key={member.id}>
                    <td className="px-4 py-3 font-semibold text-foreground">
                      {member.child_assembly?.name ?? "Ouvrage indisponible"}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {member.child_assembly?.reference_code ?? "-"}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatNumber(member.quantity, "0")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">
                      {formatCurrency(
                        Math.round(
                          member.quantity *
                            (member.child_assembly?.ds_cents ?? 0)
                        )
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}


      {isLoading ? (
        <div
          className="rounded-lg border border-border bg-surface px-4 py-5 text-sm text-muted-foreground"
          role="status"
        >
          Chargement du contenu…
        </div>
      ) : error ? (
        <Alert variant="danger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Réessayer
            </Button>
          </div>
        </Alert>
      ) : detail?.items.length ? (
        <div
          className="relative overflow-x-auto rounded-lg border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          role="region"
          aria-label={`Lignes de ${assembly.name}`}
          tabIndex={0}
        >
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="bg-surface-subtle text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5">Désignation</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Unité</th>
                <th className="px-4 py-2.5">Qté</th>
                <th className="px-4 py-2.5">H MO</th>
                <th className="px-4 py-2.5">Coût unitaire</th>
                <th className="px-4 py-2.5">Rôle MO</th>
                <th className="px-4 py-2.5">K FO</th>
                <th className="px-4 py-2.5">K MO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {[...detail.items]
                .sort((first, second) => first.position - second.position)
                .map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {formatLegacyGeneratedText(item.title)}
                    </td>
                    <td className="px-4 py-3">
                      {formatCostType(item.cost_type)}
                    </td>
                    <td className="px-4 py-3">{item.unit?.trim() || "-"}</td>
                    <td className="px-4 py-3 font-mono">
                      {formatNumber(item.default_quantity)}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {`${formatNumber(
                        typeof item.h_mo === "number"
                          ? item.h_mo
                          : item.cost_type === "labor"
                            ? item.default_quantity
                            : 0,
                      )} h`}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatCurrency(item.unit_cost_ht_cents)}
                    </td>
                    <td className="px-4 py-3">
                      {laborRoles.find((role) => role.id === item.labor_role_id)?.name ??
                        (item.labor_role_id ? item.labor_role_id.slice(0, 8) : "-")}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatNumber(item.k_fo, "1")}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatNumber(item.k_mo, "1")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border-strong bg-surface px-4 py-5 text-sm text-muted-foreground">
          Cet ouvrage ne contient aucune ligne directe.
        </div>
      )}
    </div>
  );
}

export function AssemblyLibraryTable({
  assemblies,
  busyAssemblyId,
  laborRoles,
  refreshedAssemblies,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
  loadAssembly,
}: AssemblyLibraryTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detailById, setDetailById] = useState<
    Record<string, EstimateAssemblyDetail>
  >({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [loadErrorById, setLoadErrorById] = useState<Record<string, string>>(
    {},
  );
  const loadingIdsRef = useRef<Set<string>>(new Set());

  async function loadAssemblyDetail(assemblyId: string) {
    if (loadingIdsRef.current.has(assemblyId)) return;

    loadingIdsRef.current.add(assemblyId);
    setLoadingIds((previous) => new Set(previous).add(assemblyId));
    setLoadErrorById((previous) => {
      const next = { ...previous };
      delete next[assemblyId];
      return next;
    });

    try {
      const detail = await loadAssembly(assemblyId);
      setDetailById((previous) => ({
        ...previous,
        [assemblyId]: detail,
      }));
    } catch (error) {
      setLoadErrorById((previous) => ({
        ...previous,
        [assemblyId]:
          error instanceof Error
            ? error.message
            : "Impossible de charger le contenu de l'ouvrage.",
      }));
    } finally {
      loadingIdsRef.current.delete(assemblyId);
      setLoadingIds((previous) => {
        const next = new Set(previous);
        next.delete(assemblyId);
        return next;
      });
    }
  }

  function toggleAssembly(assembly: EstimateAssemblySummary) {
    const shouldExpand = !expandedIds.has(assembly.id);
    const detail =
      refreshedAssemblies?.[assembly.id] ?? detailById[assembly.id];

    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (shouldExpand) next.add(assembly.id);
      else next.delete(assembly.id);
      return next;
    });

    if (shouldExpand && !detail) {
      void loadAssemblyDetail(assembly.id);
    }
  }

  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Bibliothèque d'ouvrages"
      tabIndex={0}
    >
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Nom</th>
            <th scope="col">Description</th>
            <th scope="col">Contenu</th>
            <th scope="col">Créé le</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {assemblies.length === 0 ? (
            <EmptyTableRow
              colSpan={5}
              icon={<BoxesIcon />}
              title="Aucun ouvrage disponible"
              description="Créez un ouvrage pour réutiliser un groupe de lignes dans vos chiffrages."
            />
          ) : (
            assemblies.map((assembly) => {
              const isBusy = busyAssemblyId === assembly.id;
              const isExpanded = expandedIds.has(assembly.id);
              const detail =
                refreshedAssemblies?.[assembly.id] ?? detailById[assembly.id];
              const isLoadingDetail = loadingIds.has(assembly.id);
              const loadError = loadErrorById[assembly.id];
              const previewId = "assembly-preview-" + assembly.id;
              return (
                <Fragment key={assembly.id}>
                  <tr>
                    <td>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => toggleAssembly(assembly)}
                          aria-controls={previewId}
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? "Masquer le contenu de " + assembly.name
                              : "Afficher le contenu de " + assembly.name
                          }
                        >
                          <ChevronRightIcon
                            aria-hidden="true"
                            className={cn(
                              "transition-transform motion-reduce:transition-none",
                              isExpanded && "rotate-90"
                            )}
                          />
                        </Button>
                        <div className="font-semibold text-foreground">
                          {assembly.name}
                        </div>
                      </div>
                    </td>
                    <td className="text-foreground-secondary">
                      {assembly.description?.trim()
                        ? formatLegacyGeneratedText(assembly.description.trim())
                        : "-"}
                    </td>
                    <td className="whitespace-nowrap">
                      {formatContentCount(assembly.itemCount, assembly.memberCount ?? 0)}
                    </td>
                    <td className="whitespace-nowrap">{formatDate(assembly.createdAt)}</td>
                    <td>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={isBusy}
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions pour ${assembly.name}`}
                            />
                          }
                        >
                          <EllipsisIcon aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuItem onClick={() => onEdit(assembly)}>
                            <PencilIcon aria-hidden="true" />
                            Éditer
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onRename(assembly)}>
                            <TypeIcon aria-hidden="true" />
                            Renommer
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onDuplicate(assembly)}>
                            <CopyIcon aria-hidden="true" />
                            Dupliquer
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onClick={() => onDelete(assembly)}>
                            <Trash2Icon aria-hidden="true" />
                            Supprimer
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr id={previewId} className="bg-surface-subtle">
                      <td colSpan={5} className="!px-6 !py-4">
                        <AssemblyContentPreview
                          assembly={assembly}
                          laborRoles={laborRoles}
                          detail={detail}
                          isLoading={isLoadingDetail}
                          error={loadError}
                          onRetry={() => void loadAssemblyDetail(assembly.id)}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
