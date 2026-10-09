"use client";

import Link from "next/link";
import { FolderIcon, PlusIcon, SearchIcon } from "lucide-react";

import { formatEUR } from "@/lib/money";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AffaireConfirmDialog } from "./AffaireConfirmDialog";
import { AffaireApprovalBadge, AffaireStatusBadges } from "./AffaireStatusBadges";
import { AffaireRowActions, getAffaireListItemState } from "./AffaireRowActions";
import { useDeleteAffaire } from "./useDeleteAffaire";
import type { AffaireListItem } from "./types";

type AffairesEmptyVariant = "no-data" | "filtered";

type Props = {
  items: AffaireListItem[];
  emptyVariant: AffairesEmptyVariant;
  onCreateAffaire?: () => void;
  onToggleFavorite: (projectId: string, nextIsFavorite: boolean) => void;
  favoritePendingIds: string[];
  selectedProjectIds?: ReadonlySet<string>;
  onToggleProjectSelection?: (projectId: string) => void;
};

const EMPTY_SELECTED_PROJECT_IDS: ReadonlySet<string> = new Set();

const AFFAIRE_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function formatDate(iso: string): string {
  return AFFAIRE_DATE_FORMATTER.format(new Date(iso));
}

export function AffairesCardList({
  items,
  emptyVariant,
  onCreateAffaire,
  onToggleFavorite,
  favoritePendingIds,
  selectedProjectIds = EMPTY_SELECTED_PROJECT_IDS,
  onToggleProjectSelection,
}: Readonly<Props>) {
  const { requestDelete, modalProps } = useDeleteAffaire();

  if (items.length === 0) {
    return emptyVariant === "no-data" ? (
      <EmptyState
        icon={<FolderIcon aria-hidden="true" />}
        title="Créez votre première affaire"
        description="Démarrez un nouveau projet pour lancer votre premier chiffrage."
        action={
          onCreateAffaire ? (
            <Button size="lg" leftIcon={<PlusIcon aria-hidden="true" />} onClick={onCreateAffaire}>
              Nouvelle affaire
            </Button>
          ) : undefined
        }
      />
    ) : (
      <EmptyState
        icon={<SearchIcon aria-hidden="true" />}
        title="Aucune affaire trouvée"
        description="Modifiez vos filtres ou votre recherche pour afficher des résultats."
      />
    );
  }

  return (
    <>
      <AffaireConfirmDialog {...modalProps} />
      <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Affaires">
        {items.map((item) => {
          const { hasCurrentVersion, isDraftOnly } = getAffaireListItemState(item);

          return (
            <li
              key={item.projectId}
              className="min-w-0 [content-visibility:auto] [contain-intrinsic-size:auto_220px]"
            >
              <Card className="relative flex h-full flex-col overflow-hidden transition-shadow hover:shadow-card-hover">
                <Link
                  href={`/dashboard/affaires/${item.projectId}`}
                  prefetch={false}
                  className="block flex-1 rounded-t-lg p-4 pb-3 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold text-foreground">
                        {item.projectName}
                      </h2>
                      {item.projectClient && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {item.projectClient}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {item.hasDpgf && (
                        <Badge variant="info" size="sm">
                          DPGF
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {item.versionCount} version{item.versionCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>

                  {item.projectReference && (
                    <p className="mb-2 truncate text-xs text-muted-foreground">
                      Réf. {item.projectReference}
                    </p>
                  )}

                  <div className="mb-3 flex flex-wrap items-center gap-1.5">
                    {hasCurrentVersion ? (
                      <AffaireStatusBadges
                        currentVersionNumber={item.currentVersionNumber!}
                        currentStatus={item.currentStatus!}
                        acceptedVersionNumber={item.acceptedVersionNumber}
                      />
                    ) : (
                      <span className="text-xs font-medium text-muted-foreground">
                        Aucun chiffrage
                      </span>
                    )}
                    <AffaireApprovalBadge approvalStatus={item.currentApprovalStatus} />
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground-secondary">
                      {item.currentTotalHtCents !== null
                        ? `${formatEUR(item.currentTotalHtCents)} HT`
                        : "—"}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDate(item.currentUpdatedAt)}
                    </span>
                  </div>
                </Link>

                <div className="flex items-center gap-1 border-t border-border-subtle px-3 py-2">
                  {isDraftOnly && onToggleProjectSelection ? (
                    <label className="mr-auto inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control px-1 text-xs text-muted-foreground sm:min-h-8">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border-strong text-primary"
                        checked={selectedProjectIds.has(item.projectId)}
                        aria-label={`Sélectionner l'affaire ${item.projectName}`}
                        onChange={() => onToggleProjectSelection(item.projectId)}
                      />
                      <span aria-hidden="true">Sélectionner</span>
                    </label>
                  ) : (
                    <span className="mr-auto" />
                  )}
                  <AffaireRowActions
                    item={item}
                    touch
                    isFavoritePending={favoritePendingIds.includes(item.projectId)}
                    onToggleFavorite={() =>
                      onToggleFavorite(item.projectId, !item.isFavorite)
                    }
                    onRequestDelete={() =>
                      requestDelete(item.projectId, item.projectName)
                    }
                  />
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}
