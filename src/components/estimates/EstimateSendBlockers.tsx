"use client";

import Link from "next/link";

import { EstimatePdfDownloadButton } from "@/components/estimates/EstimatePdfDownloadButton";
import type { EstimateEditorData, EstimateSendGatingFlag } from "@/lib/estimates/client";
import { ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS } from "@/lib/estimates/gating-policy";
import { resolveEstimateReadinessCategoryFromGatingFlagKey } from "@/lib/estimates/readiness";
import { buildSendBlockerRegisterHref, formatSendBlockerRegisterAction } from "@/lib/estimates/send-blocker-remedies";
import type { EstimateStatus } from "@/lib/estimates/status";

const LINK_CLASS = "inline-flex text-xs font-medium text-primary underline underline-offset-2";

type EstimateSendBlockersProps = {
  flags: readonly EstimateSendGatingFlag[];
  versionId: string;
  versionStatus: EstimateStatus;
  projectId?: string | null;
  /** The editor, for the lines' blockers: absent in the editor itself, where the lines are. */
  editHref?: string | null;
  /** Shown after the list: whether an administrator may force the send, and for which blockers not. */
  showForceNote?: boolean;
  /**
   * The list opens on demand: the editor's alert keeps one line whatever its blockers, so the grid under it never moves
   * when a write adds or lifts one (V3E20, V3E21, bulk-edit undo).
   */
  collapsible?: boolean;
  onBeforeGeneratePdf?: () => Promise<boolean>;
  onPdfPrepared?: (data: EstimateEditorData) => void;
  /** The PDF is ready: the caller reads the send's preconditions again. */
  onPdfReady?: () => void;
};

/** The lines a flag names; a flag on the version itself (budget, margin tiers, V0) names the version, not a line. */
function lineCount(flag: EstimateSendGatingFlag, versionId: string) {
  return flag.itemIds.filter((id) => id !== versionId).length;
}

function forceNote(flags: readonly EstimateSendGatingFlag[]) {
  const unforceable = flags.filter((flag) =>
    (ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS as readonly string[]).includes(flag.key));
  if (unforceable.length === 0) return "Un administrateur peut aussi forcer l’envoi.";
  const one = unforceable.length === 1;
  if (unforceable.length === flags.length) {
    return one
      ? "Aucun forçage ne la laisse partir : elle se corrige dans le devis."
      : "Aucun forçage ne les laisse partir : elles se corrigent dans le devis.";
  }
  return `Un administrateur peut forcer l’envoi, sauf pour ${unforceable.map((flag) => `« ${flag.label} »`).join(", ")} : aucun forçage ne ${one ? "la" : "les"} laisse partir.`;
}

/**
 * Names each blocker of the send with its description and the action that lifts it (TI-691): « PDF absent » is not a
 * line, and a bare « des anomalies bloquantes » left the owner with nothing to correct.
 */
export function EstimateSendBlockers({
  flags,
  versionId,
  versionStatus,
  projectId = null,
  editHref = null,
  showForceNote = false,
  collapsible = false,
  onBeforeGeneratePdf,
  onPdfPrepared,
  onPdfReady,
}: Readonly<EstimateSendBlockersProps>) {
  const count = flags.length;
  const title = `Envoi bloqué : ${count === 1 ? "une anomalie" : `${count} anomalies`} à lever avant l’envoi.`;
  const list = (
    <>
      <ul className="space-y-2" aria-label="Anomalies bloquant l’envoi">
        {flags.map((flag) => {
          const category = flag.category ?? resolveEstimateReadinessCategoryFromGatingFlagKey(flag.key);
          const registerAction = formatSendBlockerRegisterAction(flag);
          const count = category === "estimate_quality" ? lineCount(flag, versionId) : 0;
          const lines = count > 0 ? `${count} ligne${count > 1 ? "s" : ""}` : null;
          return (
            <li key={flag.key} className="rounded-md border border-border bg-surface px-3 py-2 text-foreground">
              <p className="text-sm font-semibold">
                {flag.label}
                {lines ? <span className="font-normal text-muted-foreground">{` · ${lines}`}</span> : null}
              </p>
              <p className="mt-0.5 text-xs text-foreground-secondary">{flag.description}</p>
              {category === "pdf" ? (
                <div className="mt-2">
                  <EstimatePdfDownloadButton
                    versionId={versionId}
                    versionStatus={versionStatus}
                    className="self-start"
                    label="Générer le PDF"
                    onBeforeGenerate={onBeforeGeneratePdf}
                    onPrepared={onPdfPrepared}
                    onSuccess={() => onPdfReady?.()}
                  />
                </div>
              ) : registerAction ? (
                <div className="mt-2 space-y-1">
                  <p className="text-xs font-medium text-primary">{registerAction}</p>
                  {projectId ? (
                    <Link href={buildSendBlockerRegisterHref(projectId, flag)} className={LINK_CLASS}>
                      Ouvrir le registre affaire
                    </Link>
                  ) : null}
                </div>
              ) : count > 0 && editHref ? (
                <Link href={editHref} className={`${LINK_CLASS} mt-2`}>
                  Corriger dans l’éditeur
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
      {showForceNote ? <p className="text-xs">{forceNote(flags)}</p> : null}
    </>
  );
  if (collapsible) {
    return (
      <details className="group" data-testid="estimate-send-blockers">
        <summary className="cursor-pointer list-none">
          <span className="font-medium">{title}</span>{" "}
          <span className="text-xs font-medium underline underline-offset-2 group-open:hidden">Voir le détail</span>
          <span className="hidden text-xs font-medium underline underline-offset-2 group-open:inline">Masquer le détail</span>
        </summary>
        <div className="mt-2 space-y-2">{list}</div>
      </details>
    );
  }
  return (
    <div className="space-y-2" data-testid="estimate-send-blockers">
      <p className="font-medium">{title}</p>
      {list}
    </div>
  );
}
