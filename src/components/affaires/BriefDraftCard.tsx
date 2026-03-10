"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import type {
  AffaireIntakeBriefBlockKey,
  AffaireIntakeBriefDraft,
  AffaireIntakeBriefSource,
} from "@/lib/affaires/intake";
import {
  AFFAIRE_INTAKE_BRIEF_BLOCK_LABELS,
  normalizeAffaireIntakeTextList,
} from "@/lib/affaires/intake";
import {
  updateAffaireBrief,
  confirmAffaireBrief,
} from "@/app/dashboard/affaires/_actions/intake";
import {
  COCKPIT_OPEN_SURFACE_EVENT,
  type CockpitOpenSurfaceEventDetail,
} from "@/lib/cockpit/events";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type BriefDraftCardProps = {
  projectId: string;
  briefDraft: AffaireIntakeBriefDraft | null;
  isReadOnly?: boolean;
};

type BadgeVariant = "neutral" | "info" | "success" | "warning" | "error";

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
  "project_object",
  "scope",
  "lots",
  "received_pieces",
  "assumptions",
  "vigilance_points",
  "missing_elements",
  "summary",
];

const PROVENANCE_LABELS: Partial<Record<AffaireIntakeBriefBlockKey, { label: string; variant: BadgeVariant }>> = {
  scope: { label: "Détecté", variant: "info" },
  assumptions: { label: "Hypothèse", variant: "warning" },
  vigilance_points: { label: "Vigilance", variant: "warning" },
  missing_elements: { label: "Manquant", variant: "error" },
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
    return <Badge variant="success" size="sm">Confirmé</Badge>;
  }
  return <Badge variant="warning" size="sm">À confirmer</Badge>;
}

/* ------------------------------------------------------------------ */
/*  BriefSourceAnnotation                                              */
/* ------------------------------------------------------------------ */

function BriefSourceAnnotation({ sources }: { sources: AffaireIntakeBriefSource[] }) {
  if (sources.length === 0) return null;
  const fileNames = [...new Set(sources.map((s) => s.sourceFileName))];
  return (
    <span className="inline-flex items-center gap-1 text-xs text-[var(--slate-400)]">
      <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      {fileNames.join(", ")}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  BriefEditableList                                                  */
/* ------------------------------------------------------------------ */

function BriefEditableList({
  items,
  onChange,
  maxItems,
}: {
  items: string[];
  onChange: (next: string[]) => void;
  maxItems: number;
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
          <input
            type="text"
            value={item}
            onChange={(e) => handleChange(i, e.target.value)}
            className="flex-1 rounded-lg border border-[var(--slate-300)] bg-surface px-2 py-1.5 text-sm text-[var(--slate-800)] focus:border-[var(--brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]"
          />
          <button
            type="button"
            onClick={() => handleRemove(i)}
            aria-label={`Supprimer: ${item}`}
            className="shrink-0 rounded-md p-1 text-[var(--slate-400)] hover:bg-[var(--warning)]/10 hover:text-danger"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ))}
      {items.length < maxItems && (
        <button
          type="button"
          onClick={handleAdd}
          className="text-xs font-medium text-[var(--brand-blue)] hover:underline"
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
  blockKey,
  items,
  paragraph,
  sourceLookup,
  isEditing,
  editItems,
  onEditItemsChange,
  editParagraph,
  onEditParagraphChange,
}: {
  blockKey: AffaireIntakeBriefBlockKey;
  items?: string[];
  paragraph?: string;
  sourceLookup: Map<string, AffaireIntakeBriefSource[]>;
  isEditing: boolean;
  editItems?: string[];
  onEditItemsChange?: (next: string[]) => void;
  editParagraph?: string;
  onEditParagraphChange?: (next: string) => void;
}) {
  const label = AFFAIRE_INTAKE_BRIEF_BLOCK_LABELS[blockKey];
  const isEditable = EDITABLE_BLOCKS.has(blockKey);
  const provenance = PROVENANCE_LABELS[blockKey];
  const paragraphSources = sourceLookup.get(`${blockKey}:0`) ?? [];

  return (
    <div className={`space-y-1.5${blockKey === "missing_elements" && items && items.length > 0 ? " rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-3 py-2.5" : ""}`}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--slate-500)]">
          {label}
        </h3>
        {isEditable && isEditing && (
          <svg className="h-3.5 w-3.5 text-[var(--brand-blue)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        )}
        {provenance && (
          <Badge variant={provenance.variant} size="sm">{provenance.label}</Badge>
        )}
      </div>

      {/* Editing mode for paragraph (summary) */}
      {isEditing && isEditable && editParagraph !== undefined && onEditParagraphChange ? (
        <div>
          <textarea
            value={editParagraph}
            onChange={(e) => onEditParagraphChange(e.target.value.slice(0, MAX_SUMMARY_LENGTH))}
            rows={4}
            className="w-full rounded-lg border border-[var(--slate-300)] bg-surface px-3 py-2 text-sm text-[var(--slate-800)] focus:border-[var(--brand-blue)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]"
          />
          <p className="mt-0.5 text-right text-xs text-[var(--slate-400)]">
            {editParagraph.length}/{MAX_SUMMARY_LENGTH}
          </p>
        </div>
      ) : isEditing && isEditable && editItems !== undefined && onEditItemsChange ? (
        /* Editing mode for lists */
        <BriefEditableList items={editItems} onChange={onEditItemsChange} maxItems={MAX_LIST_ITEMS} />
      ) : paragraph !== undefined ? (
        /* Read-only paragraph */
        <>
          <p className="text-sm text-[var(--slate-700)]">{paragraph}</p>
          {paragraphSources.length > 0 && <BriefSourceAnnotation sources={paragraphSources} />}
        </>
      ) : items && items.length > 0 ? (
        /* Read-only list */
        <ul className="space-y-1">
          {items.map((item, i) => {
            const entrySources = sourceLookup.get(`${blockKey}:${i}`) ?? [];
            return (
              <li key={i} className="flex flex-col gap-0.5">
                <span className="text-sm text-[var(--slate-700)]">
                  {blockKey === "missing_elements" && (
                    <Badge variant="error" size="sm" className="mr-1.5">!</Badge>
                  )}
                  {item}
                </span>
                {entrySources.length > 0 && blockKey !== "received_pieces" && <BriefSourceAnnotation sources={entrySources} />}
              </li>
            );
          })}
        </ul>
      ) : items && items.length === 0 && !isEditing ? (
        <p className="text-sm italic text-[var(--slate-400)]">Aucun élément détecté</p>
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
}: Readonly<BriefDraftCardProps>) {
  const router = useRouter();
  const toast = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

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
        isReadOnly
      ) {
        return;
      }

      setShowConfirmDialog(true);
      setError(null);
    };

    document.addEventListener(COCKPIT_OPEN_SURFACE_EVENT, handleOpenSurface);
    return () =>
      document.removeEventListener(COCKPIT_OPEN_SURFACE_EVENT, handleOpenSurface);
  }, [briefDraft, isReadOnly, projectId]);

  const handleStartEdit = useCallback(() => {
    if (!briefDraft) return;
    setEditSummary(briefDraft.summary);
    setEditScope([...briefDraft.scope]);
    setEditVigilancePoints([...briefDraft.vigilancePoints]);
    setEditAssumptions([...briefDraft.assumptions]);
    setError(null);
    setIsEditing(true);
  }, [briefDraft]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setError(null);
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
        await updateAffaireBrief({
          projectId,
          ...nextPayload,
        });
        setIsEditing(false);
        setAnnouncement("Brief mis à jour.");
        toast.success({ title: "Brief mis à jour." });
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
    startTransition(async () => {
      try {
        await confirmAffaireBrief({ projectId });
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
  }, [projectId, router, toast]);

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

  return (
    <section className="dashboard-card p-5" aria-label="Brief affaire">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">Brief affaire</h2>
          {briefDraft && <BriefStatusBadge status={briefDraft.status} />}
          {generationDate && (
            <span className="text-xs text-[var(--slate-400)]">{generationDate}</span>
          )}
        </div>
        {briefDraft && !isReadOnly && (
          <div className="flex items-center gap-2">
            {!isEditing && (
              <button
                type="button"
                onClick={handleStartEdit}
                className="btn btn-ghost btn-sm text-xs"
              >
                Modifier
              </button>
            )}
            {!isEditing && briefDraft.status === "a_confirmer" && (
              <button
                type="button"
                onClick={() => setShowConfirmDialog(true)}
                disabled={isPending}
                aria-busy={isPending}
                className="btn btn-primary btn-sm text-xs"
              >
                {isPending ? "..." : "Confirmer le brief"}
              </button>
            )}
          </div>
        )}
      </div>


      {/* Executive summary banner */}
      {briefDraft && !isEditing && !showConfirmDialog && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-[var(--slate-50)] px-4 py-2.5 text-sm">
          <span className="font-medium text-[var(--slate-700)]">{briefDraft.receivedPieces.length} pièces</span>
          <span className="font-medium text-[var(--slate-700)]">{briefDraft.assumptions.length} hypothèses</span>
          <span className="font-medium text-[var(--slate-700)]">{briefDraft.vigilancePoints.length} vigilance</span>
          {briefDraft.missingElements.length > 0 ? (
            <span className="font-medium text-danger">{briefDraft.missingElements.length} manquant(s)</span>
          ) : (
            <span className="font-medium text-success">Dossier complet</span>
          )}
        </div>
      )}

      {/* Confirmation dialog */}
      {showConfirmDialog && briefDraft && (
        <div className="mt-3 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/5 px-4 py-3">
          <p className="text-sm font-medium text-[var(--slate-800)]">Confirmer ce brief ?</p>
          <p className="mt-1 text-xs text-[var(--slate-600)]">
            {briefDraft.assumptions.length} hypothèse(s) ouverte(s), {briefDraft.missingElements.length} élément(s) manquant(s), {briefDraft.vigilancePoints.length} point(s) de vigilance.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => { setShowConfirmDialog(false); handleConfirm(); }} disabled={isPending} className="btn btn-primary btn-sm text-xs">
              {isPending ? "..." : "Oui, confirmer"}
            </button>
            <button type="button" onClick={() => setShowConfirmDialog(false)} disabled={isPending} className="btn btn-secondary btn-sm text-xs">
              Annuler
            </button>
          </div>
        </div>
      )}
      {/* Empty state */}
      {!briefDraft && (
        <div className="mt-4">
          <EmptyState
            icon={
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            }
            title="Aucun brief généré"
            description="Le brief sera généré automatiquement après le traitement des documents."
          />
        </div>
      )}

      {/* Content blocks */}
      {briefDraft && (
        <div className="mt-4 space-y-5">
          {BLOCK_ORDER.map((blockKey) => {
            const blockData = getBlockData(blockKey);
            const editProps = isEditing ? getEditProps(blockKey) : {};
            return (
              <BriefBlockSection
                key={blockKey}
                blockKey={blockKey}
                sourceLookup={sourceLookup}
                isEditing={isEditing}
                {...blockData}
                {...editProps}
              />
            );
          })}
        </div>
      )}

      {/* Edit footer */}
      {isEditing && (
        <div className="sticky bottom-0 z-10 -mx-5 mt-4 flex items-center gap-2 border-t border-[var(--slate-200)] bg-surface px-5 py-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            aria-busy={isPending}
            className="btn btn-primary btn-sm text-xs"
          >
            {isPending ? "..." : "Enregistrer"}
          </button>
          <button
            type="button"
            onClick={handleCancelEdit}
            disabled={isPending}
            className="btn btn-secondary btn-sm text-xs"
          >
            Annuler
          </button>
        </div>
      )}

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
