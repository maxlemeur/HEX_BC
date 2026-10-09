"use client";

import Link from "next/link";
import { CheckIcon, CopyIcon, InboxIcon } from "lucide-react";

import { EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ImportListItem } from "@/hooks/useImportFlow";

type ImportHistoryTableProps = {
  copiedImportId: string | null;
  isLoadingImports: boolean;
  items: ImportListItem[];
  onCopyImportId: (importId: string) => void | Promise<void>;
};

const COLUMN_COUNT = 6;

function formatDate(value: string | null): string {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function formatRowsCount(value: number | null): string {
  if (value === null) return "-";
  return new Intl.NumberFormat("fr-FR").format(value);
}

function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "En attente";
    case "parsing":
    case "processing":
      return "En cours";
    case "parsed":
    case "imported":
    case "completed":
      return "Terminé";
    case "failed":
      return "Échec";
    default:
      return status;
  }
}

function statusVariant(status: string): NonNullable<BadgeProps["variant"]> {
  switch (status) {
    case "pending":
      return "neutral";
    case "parsing":
    case "processing":
      return "info";
    case "parsed":
    case "imported":
    case "completed":
      return "success";
    case "failed":
      return "danger";
    default:
      return "outline";
  }
}

export function ImportHistoryTable({
  copiedImportId,
  isLoadingImports,
  items,
  onCopyImportId,
}: ImportHistoryTableProps) {
  return (
    <div className="table-scroll relative overflow-x-auto" role="region" aria-label="Historique des imports" tabIndex={0}>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">ID</th>
            <th scope="col">Nom</th>
            <th scope="col">Statut</th>
            <th scope="col">Lignes</th>
            <th scope="col">Date</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {isLoadingImports ? (
            <tr>
              <td colSpan={COLUMN_COUNT} className="p-0">
                <LoadingState label="Chargement des imports…" className="py-8" />
              </td>
            </tr>
          ) : items.length === 0 ? (
            <EmptyTableRow
              colSpan={COLUMN_COUNT}
              variant="compact"
              icon={<InboxIcon />}
              title="Aucun import trouvé"
              description="Modifiez le filtre ou la recherche, ou importez un nouveau fichier."
            />
          ) : (
            items.map((item) => {
              const copied = copiedImportId === item.id;
              return (
                <tr key={item.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-foreground-secondary">{item.id.slice(0, 8)}</code>
                      <Button
                        variant="link"
                        size="xs"
                        aria-label={copied ? "Identifiant copié" : `Copier l’identifiant de ${item.fileName}`}
                        onClick={() => void onCopyImportId(item.id)}
                        leftIcon={copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
                      >
                        {copied ? "Copié" : "Copier"}
                      </Button>
                    </div>
                  </td>
                  <td className="max-w-72">
                    <span className="block truncate font-medium text-foreground" title={item.fileName}>
                      {item.fileName}
                    </span>
                  </td>
                  <td>
                    <Badge variant={statusVariant(item.status)} size="sm">
                      {statusLabel(item.status)}
                    </Badge>
                  </td>
                  <td className="font-mono text-foreground-secondary">
                    {formatRowsCount(item.rowsCount)}
                  </td>
                  <td className="text-sm text-muted-foreground">{formatDate(item.createdAt)}</td>
                  <td>
                    {["parsed", "imported", "completed"].includes(item.status) ? (
                      <Link
                        href={`/dashboard/mappings?import_id=${item.id}`}
                        className={buttonVariants({ variant: "link", size: "xs" })}
                        aria-label={`Continuer le mapping de ${item.fileName}`}
                      >
                        Continuer
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
