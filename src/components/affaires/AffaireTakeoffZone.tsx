"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { BellIcon, SlidersHorizontalIcon } from "lucide-react";

import {
  readAffaireTakeoffZoneAction,
} from "@/app/dashboard/affaires/_actions/takeoff";
import { LaunchMetreDialog, type LaunchMetreDialogMode } from "@/components/affaires/LaunchMetreDialog";
import { TakeoffAssumeControls } from "@/components/takeoff/TakeoffAssumeControls";
import { useToast } from "@/components/feedback/toast-provider";
import { NavigationLink as Link } from "@/components/navigation/NavigationFeedback";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AffaireDossierState } from "@/lib/affaires/intake";
import type { AffaireHubPlansSummaryData } from "@/lib/affaires/hub-plans-summary";
import { useOptionalUserContext } from "@/lib/auth/user-context";
import { unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import {
  buildAffaireTakeoffZone,
  type AffaireTakeoffZoneData,
  type AffaireTakeoffZoneLink,
  type AffaireTakeoffZoneModel,
  type AffaireTakeoffZoneTone,
} from "@/lib/takeoff/affaire-takeoff-zone";
import { cn } from "@/lib/utils";

/** The anchor of the zone: the affaire's shortcuts, bookmarks and notices lead here. */
export const AFFAIRE_TAKEOFF_ZONE_ID = "metre";

const TONE_BADGE: Record<AffaireTakeoffZoneTone, NonNullable<BadgeProps["variant"]>> = {
  neutral: "neutral", info: "info", progress: "brand", success: "success", warning: "warning", danger: "danger",
};
// A request or an analysis in flight changes without a gesture of this member: read it again while it is shown.
const LIVE_REFRESH_MS = 15_000;
const ACTION_CLASS = "min-h-11 max-sm:w-full sm:min-h-9";

const OMITTED_PLAN: Record<string, string> = {
  alternate: "autre version retenue", identical_copy: "copie identique", unsupported_format: "format non lu",
  not_requested: "lu par une analyse précédente",
  not_selected: "non lu dans cette demande",
};
const OMITTED_REFERENCE: Record<string, string> = { unreadable: "illisible", unsupported_format: "format non lu", limit: "limite atteinte" };

type AffaireTakeoffZoneProps = {
  projectId: string;
  /** What the server read for the page; null when that read failed. */
  initialData: AffaireTakeoffZoneData | null;
  dossier: AffaireDossierState | null;
  planFileCount: number;
  canOperate: boolean;
  /** For the options of a launch on a version, while the automatic start is off. */
  currentVersion: { id: string; status: string; versionNumber: number } | null;
  availableVersions: Array<{ id: string; versionNumber: number }>;
  plansContext: AffaireHubPlansSummaryData | null;
  /** A deep link opened the options (`metreOptions=1`): opening them launches nothing. */
  initialOptionsOpen?: boolean;
  initialPlanSetId?: string | null;
  onReviewBrief: () => void;
  onOpenDocuments: () => void;
  onAddDocuments: () => void;
  /** After a gesture or a launch: the rest of the page reads the affaire again. */
  onChanged: () => void;
};

async function readZone(projectId: string) {
  return unwrapTakeoffActionResult(await readAffaireTakeoffZoneAction({ projectId }));
}

function ZoneLink({ link, onReviewBrief, onOpenDocuments, onAddDocuments }: {
  link: AffaireTakeoffZoneLink; onReviewBrief: () => void; onOpenDocuments: () => void; onAddDocuments: () => void;
}) {
  const className = cn(buttonVariants({ variant: "outline", size: "md" }), ACTION_CLASS);
  if (link.kind === "href") return <Link href={link.href} className={className}>{link.label}</Link>;
  const onClick = link.kind === "brief" ? onReviewBrief : link.kind === "documents" ? onOpenDocuments : onAddDocuments;
  return <button type="button" className={className} onClick={onClick}>{link.label}</button>;
}

/**
 * The takeoff's one place on the affaire: its state, the gesture it allows, its reviews, the end of its analysis and the
 * access to its options. Every former « Préparer le métré » of the affaire leads here; nothing here launches on mount.
 */
export function AffaireTakeoffZone(props: AffaireTakeoffZoneProps) {
  const { projectId, canOperate } = props;
  const toast = useToast();
  // The member of the page, in its active tenant: the zone's cache is theirs, and the zone shows only what the server
  // read for them (a session changed without a reload never shows another member's zone).
  const user = useOptionalUserContext();
  const viewerTenantId = user?.tenantId ?? props.initialData?.viewer.tenantId ?? null;
  const viewerUserId = user?.profile?.id ?? props.initialData?.viewer.userId ?? null;
  const ownData = useCallback((zoneData: AffaireTakeoffZoneData | null | undefined) => (zoneData
    && zoneData.viewer.tenantId === viewerTenantId && zoneData.viewer.userId === viewerUserId ? zoneData : null),
  [viewerTenantId, viewerUserId]);
  const initialData = useMemo(() => ownData(props.initialData), [ownData, props.initialData]);
  const [optionsOpen, setOptionsOpen] = useState(Boolean(props.initialOptionsOpen && canOperate));
  const zoneOf = useCallback((zoneData: AffaireTakeoffZoneData | null) => buildAffaireTakeoffZone({
    projectId, data: zoneData, dossier: props.dossier, planFileCount: props.planFileCount, canOperate,
  }), [canOperate, projectId, props.dossier, props.planFileCount]);
  // Stable while its inputs are: SWR restarts its polling timer whenever this function changes.
  const refreshInterval = useCallback((latest: AffaireTakeoffZoneData | undefined) =>
    (zoneOf(ownData(latest) ?? initialData)?.live ? LIVE_REFRESH_MS : 0), [initialData, ownData, zoneOf]);
  const { data, error, mutate } = useSWR(["affaire-takeoff-zone", viewerTenantId, viewerUserId, projectId], () => readZone(projectId), {
    fallbackData: initialData ?? undefined,
    // The server read failed: try again once the zone is shown, then on focus.
    revalidateOnMount: initialData === null,
    revalidateOnFocus: true,
    refreshInterval,
    keepPreviousData: true,
  });
  // An answer read for another member (or kept from another key) is never shown: the zone then says it cannot read it.
  // Everything below renders from this answer alone, validated for this member.
  const shown = useMemo(() => (data === undefined ? (error ? null : initialData) : ownData(data)),
    [data, error, initialData, ownData]);
  const model: AffaireTakeoffZoneModel | null = useMemo(() => zoneOf(shown), [shown, zoneOf]);

  const refresh = useCallback(() => {
    void mutate();
    props.onChanged();
  }, [mutate, props]);

  if (!model) return null;
  const options = model.options;
  const dialogMode: LaunchMetreDialogMode | null = !options ? null : options.mode === "version" ? { kind: "version" }
    : options.mode === "request" ? { kind: "request", predecessorJobId: options.predecessorJobId, planDispatch: shown?.planDispatch }
    : { kind: "save_only", reason: options.reason };
  const coverage = shown?.request?.coverage ?? null;
  const omitted = coverage ? [
    ...coverage.plansOmitted.map((piece) => `${piece.name} (${OMITTED_PLAN[piece.reason]})`),
    ...coverage.referencesOmitted.map((piece) => `${piece.name} (${OMITTED_REFERENCE[piece.reason]})`),
  ] : [];

  return (
    <section
      id={AFFAIRE_TAKEOFF_ZONE_ID}
      aria-labelledby="affaire-takeoff-zone-title"
      tabIndex={-1}
      className="scroll-mt-24 rounded-lg border border-border bg-surface p-4 shadow-card outline-none focus-visible:ring-2 focus-visible:ring-primary sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="affaire-takeoff-zone-title" className="text-sm font-semibold text-foreground">Métré de l’affaire</h2>
        <Badge variant={TONE_BADGE[model.tone]}>{model.status}</Badge>
      </div>
      <div aria-live="polite" className="mt-2 space-y-2">
        {model.message ? <p className="text-sm text-foreground-secondary">{model.message}</p> : null}
        {model.pieces.length > 0 ? (
          <ul aria-label="Pièces concernées" className="list-disc space-y-0.5 pl-5 text-sm text-foreground-secondary">
            {model.pieces.map((piece) => <li key={piece.id}>{piece.name}</li>)}
          </ul>
        ) : null}
        {model.facts.length > 0 || coverage ? (
          <p className="text-xs text-muted-foreground">
            {[...model.facts, ...(coverage ? [`${coverage.plansRetained} plan${coverage.plansRetained > 1 ? "s" : ""} retenu${coverage.plansRetained > 1 ? "s" : ""}`] : [])].join(" · ")}
          </p>
        ) : null}
        {omitted.length > 0 ? <p className="text-xs text-muted-foreground">Pièces non lues : {omitted.join(", ")}.</p> : null}
        {model.dossierChange ? (
          <div className="rounded-lg border border-warning-border bg-warning-subtle p-3 text-sm">
            <p className="font-medium text-foreground">Dossier modifié depuis l’analyse</p>
            <ul className="mt-1 space-y-0.5 text-foreground-secondary">
              {model.dossierChange.added.length > 0 ? <li>Ajoutés : {model.dossierChange.added.map((piece) => piece.name).join(", ")}</li> : null}
              {model.dossierChange.replaced.length > 0 ? <li>Remplacés : {model.dossierChange.replaced.map((piece) => piece.name).join(", ")}</li> : null}
              {model.dossierChange.removed.length > 0 ? <li>Retirés : {model.dossierChange.removed.map((piece) => piece.name).join(", ")}</li> : null}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">L’analyse ne change pas d’elle-même : relancez-la depuis les options du métré pour en tenir compte.</p>
          </div>
        ) : null}
        {model.notice ? (
          <p className="flex items-start gap-2 text-sm text-foreground-secondary">
            <BellIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span>
              <span className="font-medium text-foreground">{model.notice.title}</span> · {model.notice.at}
              {model.notice.reason ? <span className="block text-xs text-muted-foreground">{model.notice.reason}</span> : null}
            </span>
          </p>
        ) : null}
        {model.awayFromMac ? (
          <p className="text-sm text-muted-foreground">Pour reprendre avec votre forfait, ouvrez MergeOne sur le Mac connecté.</p>
        ) : null}
      </div>
      {model.gesture || model.reviews.length > 0 || model.links.length > 0 || dialogMode ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {model.gesture ? (
            <TakeoffAssumeControls key={`${model.gesture.requestId}:${model.gesture.revision}`} projectId={projectId}
              requestId={model.gesture.requestId} revision={model.gesture.revision} action={model.gesture.kind}
              label={model.gesture.label} busyLabel="Prise en charge…" className={ACTION_CLASS} onChanged={(result, viaKey) => {
                if (!result) { void mutate(); return; }
                const verb = model.gesture?.kind === "resume" ? "Métré repris" : "Métré pris en charge";
                toast.success({ title: `${verb} avec ${viaKey ? "votre clé API" : "votre forfait"}`,
                  description: result.message ?? "Le Mac connecté vérifie les plans avant de lancer l’analyse détaillée.", durationMs: 6000 });
                refresh();
              }} />
          ) : null}
          {model.reviews.map((review) => (
            <Link key={review.key} href={review.href} className={cn(buttonVariants({ variant: model.gesture ? "outline" : "primary", size: "md" }), ACTION_CLASS)}>
              {review.label}
            </Link>
          ))}
          {dialogMode ? (
            <Button variant="outline" size="md" className={ACTION_CLASS} onClick={() => setOptionsOpen(true)}>
              <SlidersHorizontalIcon aria-hidden="true" />
              Options du métré
            </Button>
          ) : null}
          {model.links.map((link) => (
            <ZoneLink key={link.key} link={link} onReviewBrief={props.onReviewBrief} onOpenDocuments={props.onOpenDocuments}
              onAddDocuments={props.onAddDocuments} />
          ))}
        </div>
      ) : null}
      {dialogMode ? (
        <LaunchMetreDialog
          open={optionsOpen}
          onOpenChange={(open) => { setOptionsOpen(open); if (!open) void mutate(); }}
          projectId={projectId}
          launchMode={dialogMode}
          currentVersion={props.currentVersion}
          plansContext={props.plansContext}
          availableVersions={props.availableVersions}
          initialPlanSetId={props.initialPlanSetId ?? null}
          onLaunched={refresh}
        />
      ) : null}
    </section>
  );
}
