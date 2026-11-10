"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/layout/empty-state";
import { Button } from "@/components/ui/button";
import { AffaireConfirmDialog } from "@/components/affaires/AffaireConfirmDialog";
import { BRIEF_REVIEW_LABELS, BriefReviewPanel, BriefSourceAnnotation } from "@/components/affaires/BriefReviewPanel";
import { useToast } from "@/components/feedback/toast-provider";
import type {
  AffaireIntakeBriefBlockKey,
  AffaireIntakeBriefDraft,
  AffaireIntakeBriefSource,
} from "@/lib/affaires/intake";
import {
  normalizeAffaireIntakeTextList,
} from "@/lib/affaires/intake";
import {
  updateAffaireBrief,
  confirmAffaireBrief,
  resolveAffaireBriefPlanGap,
} from "@/app/dashboard/affaires/_actions/intake";
import {
  COCKPIT_OPEN_SURFACE_EVENT,
  type CockpitOpenSurfaceEventDetail,
} from "@/lib/cockpit/events";
import { ArrowRightIcon, FileIcon, InfoIcon, SquarePenIcon, XIcon } from "lucide-react";

import "./BriefDraftCard.css";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type BriefDraftCardProps = {
  projectId: string;
  briefDraft: AffaireIntakeBriefDraft | null;
  isReadOnly?: boolean;
  hideConfirmAction?: boolean;
  hasPlans?: boolean;
  onOpenDocuments?: () => void;
  onBackToDossier?: () => void;
};

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "danger";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EDITABLE_BLOCKS = new Set<AffaireIntakeBriefBlockKey>([
  "summary",
  "scope",
  "vigilance_points",
  "assumptions",
]);

const MAX_LIST_ITEMS = 12;
const MAX_SUMMARY_LENGTH = 900;
const MAX_EDITABLE_LIST_ITEM_LENGTH = 280;
const BLOCK_ORDER: AffaireIntakeBriefBlockKey[] = [
  "summary",
  "project_object",
  "scope",
  "lots",
  "received_pieces",
  "assumptions",
  "vigilance_points",
  "missing_elements",
];

const PROVENANCE_LABELS: Partial<Record<AffaireIntakeBriefBlockKey, { label: string; variant: BadgeVariant }>> = {
  scope: { label: "Détecté", variant: "info" },
  assumptions: { label: "Hypothèse", variant: "warning" },
  vigilance_points: { label: "Vigilance", variant: "warning" },
  missing_elements: { label: "Manquant", variant: "danger" },
};

/* ------------------------------------------------------------------ */
/*  Source lookup                                                       */
/* ------------------------------------------------------------------ */

function buildSourceLookup(sources: AffaireIntakeBriefSource[]) {
  const map = new Map<string, AffaireIntakeBriefSource[]>();
  for (const src of sources) {
    const key = `${src.blockKey}:${src.entryIndex}`;
    const existing = map.get(key);
    if (existing) {
      existing.push(src);
    } else {
      map.set(key, [src]);
    }
  }
  return map;
}

function areTextListsEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildEditableBriefPayload(input: {
  summary: string;
  scope: string[];
  vigilancePoints: string[];
  assumptions: string[];
}) {
  return {
    summary: input.summary.trim(),
    scope: normalizeAffaireIntakeTextList(input.scope, {
      maxItems: MAX_LIST_ITEMS,
      maxLength: MAX_EDITABLE_LIST_ITEM_LENGTH,
    }),
    vigilancePoints: normalizeAffaireIntakeTextList(input.vigilancePoints, {
      maxItems: MAX_LIST_ITEMS,
      maxLength: MAX_EDITABLE_LIST_ITEM_LENGTH,
    }),
    assumptions: normalizeAffaireIntakeTextList(input.assumptions, {
      maxItems: MAX_LIST_ITEMS,
      maxLength: MAX_EDITABLE_LIST_ITEM_LENGTH,
    }),
  };
}

function hasEditableBriefChanges(
  briefDraft: AffaireIntakeBriefDraft,
  nextPayload: ReturnType<typeof buildEditableBriefPayload>
) {
  return (
    briefDraft.summary !== nextPayload.summary ||
    !areTextListsEqual(briefDraft.scope, nextPayload.scope) ||
    !areTextListsEqual(briefDraft.vigilancePoints, nextPayload.vigilancePoints) ||
    !areTextListsEqual(briefDraft.assumptions, nextPayload.assumptions)
  );
}

/* ------------------------------------------------------------------ */
/*  BriefStatusBadge                                                   */
/* ------------------------------------------------------------------ */

function BriefStatusBadge({ status }: { status: "a_confirmer" | "confirme" }) {
  if (status === "confirme") {
    return <Badge variant="success">Confirmé</Badge>;
  }
  return <Badge variant="warning">À confirmer</Badge>;
}

/* ------------------------------------------------------------------ */
/*  BriefEditableList                                                  */
/* ------------------------------------------------------------------ */

function BriefEditableList({
  items,
  onChange,
  maxItems,
  label,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  maxItems: number;
  label: string;
}) {
  const handleChange = useCallback(
    (index: number, value: string) => {
      const next = [...items];
      next[index] = value;
      onChange(next);
    },
    [items, onChange]
  );

  const handleRemove = useCallback(
    (index: number) => {
      onChange(items.filter((_, i) => i !== index));
    },
    [items, onChange]
  );

  const handleAdd = useCallback(() => {
    if (items.length < maxItems) {
      onChange([...items, ""]);
    }
  }, [items, maxItems, onChange]);

  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <textarea
            aria-label={`${label} ${i + 1}`}
            rows={2}
            maxLength={MAX_EDITABLE_LIST_ITEM_LENGTH}
            value={item}
            onChange={(e) => handleChange(i, e.target.value)}
            className="brief-edit-field flex-1"
          />
          <button
            type="button"
            onClick={() => handleRemove(i)}
            aria-label={`Supprimer: ${item}`}
            className="brief-remove-entry shrink-0 rounded-md text-subtle-foreground hover:bg-warning/10 hover:text-danger"
          >
            <XIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      {items.length < maxItems && (
        <button
          type="button"
          onClick={handleAdd}
          aria-label={`Ajouter : ${label}`}
          className="text-xs font-medium text-primary hover:underline"
        >
          + Ajouter
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  BriefBlockSection                                                  */
/* ------------------------------------------------------------------ */

function BriefBlockSection({
  projectId,
  blockKey,
  items,
  paragraph,
  sourceLookup,
  isEditing,
  editItems,
  onEditItemsChange,
  editParagraph,
  onEditParagraphChange,
  hasPlans,
  resolvedPlanGapIndexes,
  onResolvePlanGap,
}: {
  projectId: string;
  blockKey: AffaireIntakeBriefBlockKey;
  items?: string[];
  paragraph?: string;
  sourceLookup: Map<string, AffaireIntakeBriefSource[]>;
  isEditing: boolean;
  editItems?: string[];
  onEditItemsChange?: (next: string[]) => void;
  editParagraph?: string;
  onEditParagraphChange?: (next: string) => void;
  hasPlans?: boolean;
  resolvedPlanGapIndexes?: number[];
  onResolvePlanGap?: (index: number) => void;
}) {
  const label = BRIEF_REVIEW_LABELS[blockKey];
  const isEditable = EDITABLE_BLOCKS.has(blockKey);
  const provenance = PROVENANCE_LABELS[blockKey];
  const paragraphSources = sourceLookup.get(`${blockKey}:0`) ?? [];

  return (
    <div className={`space-y-1.5${blockKey === "missing_elements" && items && items.length > 0 ? " rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5" : ""}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h3>
        {isEditable && isEditing && (
          <SquarePenIcon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        )}
        {provenance && (
          <Badge variant={provenance.variant}>{provenance.label}</Badge>
        )}
      </div>

      {/* Editing mode for paragraph (summary) */}
      {isEditing && isEditable && editParagraph !== undefined && onEditParagraphChange ? (
        <div>
          <textarea
            aria-label={label}
            value={editParagraph}
            onChange={(e) => onEditParagraphChange(e.target.value.slice(0, MAX_SUMMARY_LENGTH))}
            rows={4}
            className="brief-edit-field"
          />
          <p className="mt-0.5 text-right text-xs text-subtle-foreground">
            {editParagraph.length}/{MAX_SUMMARY_LENGTH}
          </p>
        </div>
      ) : isEditing && isEditable && editItems !== undefined && onEditItemsChange ? (
        /* Editing mode for lists */
        <BriefEditableList items={editItems} onChange={onEditItemsChange} maxItems={MAX_LIST_ITEMS} label={label} />
      ) : paragraph !== undefined ? (
        /* Read-only paragraph */
        <>
          <p className="text-sm text-foreground-secondary">{paragraph}</p>
          <BriefSourceAnnotation
            projectId={projectId}
            sources={paragraphSources}
          />
        </>
      ) : items && items.length > 0 ? (
        /* Read-only list */
        <ul className="space-y-1">
          {items.map((item, i) => {
            const entrySources = sourceLookup.get(`${blockKey}:${i}`) ?? [];
            const planGap = blockKey === "missing_elements" && item === "Plans manquants";
            const resolvedPlanGap = planGap && hasPlans && resolvedPlanGapIndexes?.includes(i);
            return (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="text-sm text-foreground-secondary">
                  {blockKey === "missing_elements" && (
                    <Badge variant={resolvedPlanGap ? "success" : "danger"} className="mr-1.5">{resolvedPlanGap ? "Traité" : "!"}</Badge>
                  )}
                  {item}{resolvedPlanGap ? " · mention historique, plans reçus" : ""}
                </span>
                {planGap && hasPlans && !resolvedPlanGap && onResolvePlanGap && (
                  <button type="button" onClick={() => onResolvePlanGap(i)} className="self-start text-xs font-medium text-primary hover:underline">
                    Marquer les plans comme reçus
                  </button>
                )}
                {blockKey !== "received_pieces" && (
                  <BriefSourceAnnotation
                    projectId={projectId}
                    sources={entrySources}
                  />
                )}
              </li>
            );
          })}
        </ul>
      ) : items && items.length === 0 ? (
        <p className="text-sm italic text-subtle-foreground">Aucun élément détecté</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  BriefDraftCard (exported)                                          */
/* ------------------------------------------------------------------ */

export function BriefDraftCard({
  projectId,
  briefDraft,
  isReadOnly,
  hideConfirmAction = false,
  hasPlans = false,
  onOpenDocuments,
  onBackToDossier,
}: Readonly<BriefDraftCardProps>) {
  const router = useRouter();
  const toast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isEditing) sectionRef.current?.querySelector("textarea")?.focus();
  }, [isEditing]);

  // Edit state
  const [editSummary, setEditSummary] = useState("");
  const [editScope, setEditScope] = useState<string[]>([]);
  const [editVigilancePoints, setEditVigilancePoints] = useState<string[]>([]);
  const [editAssumptions, setEditAssumptions] = useState<string[]>([]);

  const sourceLookup = briefDraft ? buildSourceLookup(briefDraft.sources) : new Map<string, AffaireIntakeBriefSource[]>();

  useEffect(() => {
    const handleOpenSurface = (event: Event) => {
      const detail = (event as CustomEvent<CockpitOpenSurfaceEventDetail>).detail;
      if (
        !detail ||
        detail.projectId !== projectId ||
        detail.surfaceId !== "brief-confirm" ||
        !briefDraft ||
        briefDraft.status !== "a_confirmer" ||
        isReadOnly || isEditing
      ) {
        return;
      }

      setShowConfirmDialog(true);
      setError(null);
    };

    document.addEventListener(COCKPIT_OPEN_SURFACE_EVENT, handleOpenSurface);
    return () =>
      document.removeEventListener(COCKPIT_OPEN_SURFACE_EVENT, handleOpenSurface);
  }, [briefDraft, isReadOnly, isEditing, projectId]);

  const handleStartEdit = useCallback(() => {
    if (!briefDraft) return;
    setEditSummary(briefDraft.summary);
    setEditScope([...briefDraft.scope]);
    setEditVigilancePoints([...briefDraft.vigilancePoints]);
    setEditAssumptions([...briefDraft.assumptions]);
    setError(null);
    setShowConfirmDialog(false);
    setIsEditing(true);
  }, [briefDraft]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setError(null);
    requestAnimationFrame(() => editButtonRef.current?.focus());
  }, []);

  const handleSave = useCallback(() => {
    if (!briefDraft) return;
    setError(null);
    const nextPayload = buildEditableBriefPayload({
      summary: editSummary,
      scope: editScope,
      vigilancePoints: editVigilancePoints,
      assumptions: editAssumptions,
    });

    if (!hasEditableBriefChanges(briefDraft, nextPayload)) {
      setIsEditing(false);
      setAnnouncement("Aucune modification du brief.");
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateAffaireBrief({
          projectId,
          ...nextPayload,
        });
        setIsEditing(false);
        if (briefDraft.status === "confirme" && result?.status === "a_confirmer") {
          setAnnouncement("Brief mis à jour. Une nouvelle confirmation est requise.");
          toast.info({
            title: "Brief mis à jour.",
            description: "Le brief doit être confirmé à nouveau avant la suite du chiffrage.",
          });
        } else {
          setAnnouncement("Brief mis à jour.");
          toast.success({ title: "Brief mis à jour." });
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur lors de la sauvegarde.");
      }
    });
  }, [
    briefDraft,
    projectId,
    editSummary,
    editScope,
    editVigilancePoints,
    editAssumptions,
    router,
    toast,
  ]);

  const handleConfirm = useCallback(() => {
    if (!briefDraft?.updatedAt) {
      toast.error({ title: "Impossible de confirmer le brief", description: "Actualisez le dossier et réessayez." });
      return;
    }
    startTransition(async () => {
      try {
        await confirmAffaireBrief({ projectId, expectedUpdatedAt: briefDraft.updatedAt! });
        setAnnouncement("Brief confirmé.");
        toast.success({ title: "Brief confirmé." });
        router.refresh();
      } catch (err) {
        toast.error({
          title: "Erreur",
          description: err instanceof Error ? err.message : "Impossible de confirmer le brief.",
        });
      }
    });
  }, [briefDraft, projectId, router, toast]);

  const handleResolvePlanGap = useCallback((entryIndex: number) => {
    if (!briefDraft?.updatedAt) return;
    startTransition(async () => {
      try {
        await resolveAffaireBriefPlanGap({ projectId, entryIndex, expectedUpdatedAt: briefDraft.updatedAt! });
        toast.success({ title: "Plans marqués comme reçus. Vérifiez le brief avant confirmation." });
        router.refresh();
      } catch (err) {
        toast.error({ title: "Impossible de mettre à jour le brief", description: err instanceof Error ? err.message : "Actualisez le dossier et réessayez." });
      }
    });
  }, [briefDraft, projectId, router, toast]);

  const unresolvedMissingCount = briefDraft?.missingElements.filter((item, index) =>
    !(hasPlans && item === "Plans manquants" && briefDraft.resolvedPlanGapIndexes?.includes(index))
  ).length ?? 0;

  function getBlockData(blockKey: AffaireIntakeBriefBlockKey) {
    if (!briefDraft) return {};
    switch (blockKey) {
      case "project_object":
        return { paragraph: briefDraft.projectObject };
      case "summary":
        return { paragraph: briefDraft.summary };
      case "scope":
        return { items: briefDraft.scope };
      case "lots":
        return { items: briefDraft.lots };
      case "received_pieces":
        return { items: briefDraft.receivedPieces };
      case "assumptions":
        return { items: briefDraft.assumptions };
      case "vigilance_points":
        return { items: briefDraft.vigilancePoints };
      case "missing_elements":
        return { items: briefDraft.missingElements };
      default:
        return {};
    }
  }

  function getEditProps(blockKey: AffaireIntakeBriefBlockKey) {
    switch (blockKey) {
      case "summary":
        return { editParagraph: editSummary, onEditParagraphChange: setEditSummary };
      case "scope":
        return { editItems: editScope, onEditItemsChange: setEditScope };
      case "vigilance_points":
        return { editItems: editVigilancePoints, onEditItemsChange: setEditVigilancePoints };
      case "assumptions":
        return { editItems: editAssumptions, onEditItemsChange: setEditAssumptions };
      default:
        return {};
    }
  }

  const generationDate = briefDraft?.lastGeneratedAt
    ? new Date(briefDraft.lastGeneratedAt).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const confirmationDate = briefDraft?.confirmedAt
    ? new Date(briefDraft.confirmedAt).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;
  const isConfirmedBrief = briefDraft?.status === "confirme";
  const requiresConfirmation = briefDraft?.status === "a_confirmer";
  return (
    <section ref={sectionRef} className="brief-review" aria-label="Brief affaire">
      <header className="brief-review-header">
        <div className="brief-review-heading">
          <h2>{isEditing ? "Modifier le brief" : "Revoir le brief"}</h2>
          {briefDraft && <BriefStatusBadge status={briefDraft.status} />}
          {generationDate && (
            <p className="brief-generation-date">Généré le {generationDate}</p>
          )}
        </div>
        {briefDraft && !isReadOnly && !isEditing && (
          <Button ref={editButtonRef} variant="outline" onClick={handleStartEdit} disabled={isPending}>
            <SquarePenIcon size={17} aria-hidden="true" />Modifier le brief
          </Button>
        )}
      </header>

      {briefDraft && isConfirmedBrief && !isEditing && !showConfirmDialog && (
        <div className="brief-reference-status">
          <strong>Brief de référence</strong>
          {confirmationDate ? <span>Confirmé le {confirmationDate}</span> : null}
          <span>Une modification nécessitera une nouvelle confirmation.</span>
        </div>
      )}
      {/* Empty state */}
      {!briefDraft && (
        <div className="mt-4">
          <EmptyState
            variant="plain"
            icon={<FileIcon aria-hidden="true" />}
            title="Aucun brief généré"
            description="Le brief sera généré automatiquement après le traitement des documents."
          />
        </div>
      )}

      {/* Content blocks */}
      {briefDraft && !isEditing ? (
        <BriefReviewPanel projectId={projectId} briefDraft={briefDraft} sourceLookup={sourceLookup}
          hasPlans={hasPlans} onOpenDocuments={onOpenDocuments}
          onResolvePlanGap={!isReadOnly && !isPending && briefDraft.updatedAt ? handleResolvePlanGap : undefined} />
      ) : null}
      {briefDraft && isEditing && (
        <div className="brief-edit-body">
          {BLOCK_ORDER.map((blockKey) => {
            const blockData = getBlockData(blockKey);
            const editProps = isEditing ? getEditProps(blockKey) : {};
            return (
              <BriefBlockSection
                key={blockKey}
                projectId={projectId}
                blockKey={blockKey}
                sourceLookup={sourceLookup}
                isEditing={isEditing}
                hasPlans={hasPlans}
                resolvedPlanGapIndexes={briefDraft.resolvedPlanGapIndexes}
                onResolvePlanGap={!isReadOnly && !isEditing && !isPending && briefDraft.updatedAt ? handleResolvePlanGap : undefined}
                {...blockData}
                {...editProps}
              />
            );
          })}
        </div>
      )}

      {/* Edit footer */}
      {isEditing && (
        <div className="brief-review-footer brief-edit-footer">
          {isConfirmedBrief && (
            <p className="text-xs text-muted-foreground">
              En enregistrant, ce brief repassera à valider pour sécuriser le cadrage mis à jour.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button onClick={handleSave} loading={isPending}>
              Enregistrer
            </Button>
            <Button variant="outline" size="sm" onClick={handleCancelEdit} disabled={isPending}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {briefDraft && !isEditing ? <footer className="brief-review-footer">
        <p className="brief-confirmation-note"><InfoIcon size={19} aria-hidden="true" /><span>La confirmation fixe le cadrage ; elle ne vérifie pas les preuves et ne résout pas les manques.</span></p>
        <div className="brief-review-actions">
          {onBackToDossier ? <button type="button" className="brief-text-action" onClick={onBackToDossier}>Retour au dossier</button> : null}
          {requiresConfirmation && !isReadOnly && !hideConfirmAction ? <div className="brief-confirm-action">
            <Button onClick={() => setShowConfirmDialog(true)} loading={isPending}>Confirmer le brief<ArrowRightIcon size={17} aria-hidden="true" /></Button>
            <small>Une confirmation sera demandée.</small>
          </div> : null}
        </div>
      </footer> : null}

      <AffaireConfirmDialog open={showConfirmDialog && Boolean(briefDraft) && !isReadOnly && !isEditing}
        title="Confirmer ce brief ?"
        message={`Il deviendra la référence de travail pour la suite du chiffrage. Hypothèses ouvertes : ${briefDraft?.assumptions.length ?? 0}. Éléments manquants : ${unresolvedMissingCount}. Points de vigilance : ${briefDraft?.vigilancePoints.length ?? 0}. Confirmer ne transforme pas une inférence en preuve et ne résout pas les manques.`}
        confirmLabel="Oui, confirmer" confirmDisabled={isPending} cancelDisabled={isPending}
        onConfirm={() => { setShowConfirmDialog(false); handleConfirm(); }} onCancel={() => setShowConfirmDialog(false)} />

      {/* Inline error */}
      {error && (
        <p className="mt-2 text-xs font-medium text-danger" role="alert">{error}</p>
      )}

      {/* Accessibility: live region for announcements */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}
