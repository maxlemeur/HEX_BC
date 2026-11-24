import { conflict, internalError, mapSupabaseError, notFound } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  affaireIntakeBriefDraftSchema,
  normalizeAffaireIntakeTextList,
  type AffaireIntakeBriefBlockKey,
  type AffaireIntakeBriefDraft,
} from "@/lib/affaires/intake";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { syncAffaireRegisterFromBrief } from "@/lib/affaires/register-sync-server";
import { resolveSupabaseQuery, insertAffaireIntakeEvent } from "@/lib/affaires/intake-rows";
import { replaceAffaireBriefSourceLinks, getComparableBriefPayload, fetchAffaireBriefForProject } from "@/lib/affaires/intake-brief-store";

/** The affaire's brief as its readers see it (owner, admin or director), or null when none was drafted yet. */
export async function readAffaireBriefDraft(projectId: string) {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const brief = await fetchAffaireBriefForProject({ supabase: context.supabase, projectId: project.id });
  return brief?.draft ?? null;
}

function remapBriefSourcesForEditedDraft(input: {
  previous: AffaireIntakeBriefDraft;
  next: AffaireIntakeBriefDraft;
}) {
  const nextSources: AffaireIntakeBriefDraft["sources"] = [];
  const previousSourcesByKey = new Map<string, AffaireIntakeBriefDraft["sources"]>();

  for (const source of input.previous.sources) {
    const key = `${source.blockKey}:${source.entryIndex}`;
    previousSourcesByKey.set(key, [...(previousSourcesByKey.get(key) ?? []), source]);
  }

  const appendSources = (
    blockKey: AffaireIntakeBriefBlockKey,
    previousIndex: number,
    nextIndex: number
  ) => {
    for (const source of previousSourcesByKey.get(`${blockKey}:${previousIndex}`) ?? []) {
      nextSources.push({
        ...source,
        entryIndex: nextIndex,
      });
    }
  };

  if (input.previous.summary === input.next.summary) {
    appendSources("summary", 0, 0);
  }

  const remapListBlock = (
    blockKey: "scope" | "assumptions" | "vigilance_points",
    previousValues: ReadonlyArray<string>,
    nextValues: ReadonlyArray<string>
  ) => {
    const previousIndexByValue = new Map<string, number>();

    previousValues.forEach((value, index) => {
      previousIndexByValue.set(value, index);
    });

    nextValues.forEach((value, index) => {
      const previousIndex = previousIndexByValue.get(value);
      if (previousIndex !== undefined) {
        appendSources(blockKey, previousIndex, index);
      }
    });
  };

  remapListBlock("scope", input.previous.scope, input.next.scope);
  remapListBlock(
    "assumptions",
    input.previous.assumptions,
    input.next.assumptions
  );
  remapListBlock(
    "vigilance_points",
    input.previous.vigilancePoints,
    input.next.vigilancePoints
  );

  for (const source of input.previous.sources) {
    if (
      source.blockKey !== "summary" &&
      source.blockKey !== "scope" &&
      source.blockKey !== "assumptions" &&
      source.blockKey !== "vigilance_points"
    ) {
      nextSources.push(source);
    }
  }

  return nextSources;
}

export async function resolveAffaireBriefPlanGap(input: {
  projectId: string; entryIndex: number; expectedUpdatedAt: string;
}) {
  // The brief is completed by every reader of the affaire, a director included: read access is enough.
  const { context, project } = await requireAffaireAccess(input.projectId, "read");
  const { data, error } = await createServiceRoleClient().rpc("resolve_affaire_brief_plan_gap" as never, {
    p_project_id: project.id, p_entry_index: input.entryIndex,
    p_expected_updated_at: input.expectedUpdatedAt, p_actor_user_id: context.userId,
  } as never);
  if (error?.code === "40001") throw conflict("Le dossier ou le brief a changé. Actualisez avant de poursuivre.");
  if (error) throw mapSupabaseError(error, "Impossible de mettre à jour le brief.");
  return { changed: data === true };
}

export async function updateAffaireBrief(input: {
  projectId: string;
  summary: string;
  scope: string[];
  vigilancePoints: string[];
  assumptions: string[];
}) {
  // The brief is completed by every reader of the affaire, a director included: read access is enough.
  const { context, project } = await requireAffaireAccess(input.projectId, "read");
  const existing = await fetchAffaireBriefForProject({
    supabase: context.supabase,
    projectId: project.id,
  });

  if (!existing) {
    throw notFound("Brief affaire introuvable.");
  }

  const nextDraft = affaireIntakeBriefDraftSchema.parse({
    ...existing.draft,
    summary: input.summary.trim(),
    scope: normalizeAffaireIntakeTextList(input.scope, {
      maxItems: 12,
      maxLength: 280,
    }),
    vigilancePoints: normalizeAffaireIntakeTextList(input.vigilancePoints, {
      maxItems: 12,
      maxLength: 280,
    }),
    assumptions: normalizeAffaireIntakeTextList(input.assumptions, {
      maxItems: 12,
      maxLength: 280,
    }),
    status: "a_confirmer",
    confirmedAt: null,
  });

  const contentChanged =
    getComparableBriefPayload(existing.draft) !== getComparableBriefPayload(nextDraft);

  if (!contentChanged) {
    return {
      ok: true,
      status: existing.draft.status,
    } as const;
  }

  const nextSources = remapBriefSourcesForEditedDraft({
    previous: existing.draft,
    next: nextDraft,
  });

  const { error } = await resolveSupabaseQuery<{ error: unknown }>(
    context.supabase
      .from("affaire_briefs")
      .update({
        summary: nextDraft.summary,
        scope: nextDraft.scope,
        vigilance_points: nextDraft.vigilancePoints,
        assumptions: nextDraft.assumptions,
        status: "a_confirmer",
        confirmed_at: null,
        confirmed_by: null,
        updated_by: context.userId,
      } as never)
      .eq("id", existing.brief.id)
  );

  if (error) {
    throw internalError("Impossible de mettre à jour le brief affaire.", error);
  }

  await replaceAffaireBriefSourceLinks({
    supabase: context.supabase,
    briefId: existing.brief.id,
    sources: nextSources,
    actorUserId: context.userId,
  });

  await insertAffaireIntakeEvent({
    supabase: context.supabase,
    uploadId: existing.brief.upload_id,
    actorUserId: context.userId,
    eventType: "brief.updated",
    beforePayload: {
      status: existing.draft.status,
      summary: existing.draft.summary,
    },
    afterPayload: {
      status: "a_confirmer",
      summary: nextDraft.summary,
      scope_count: nextDraft.scope.length,
      assumption_count: nextDraft.assumptions.length,
    },
  });

  await syncAffaireRegisterFromBrief({
    supabase: context.supabase as never,
    project,
    assumptions: nextDraft.assumptions,
    sources: nextSources,
    actorUserId: context.userId,
  });

  return {
    ok: true,
    status: "a_confirmer",
  } as const;
}

/**
 * Who pays for the affaire's automatic takeoff, read when the brief's confirmation dialog opens, for this member and the
 * brief as it is now (readBriefConfirmationPayerNotice). Throws when it cannot be read: the dialog then says so.
 */
export async function readAffaireBriefPayerNotice(input: { projectId: string }) {
  const { context, project } = await requireAffaireAccess(input.projectId, "read");
  const [{ readBriefConfirmationPayerNotice }, { headers }] = await Promise.all([
    import("@/lib/takeoff/launch-request-server"), import("next/headers"),
  ]);
  return readBriefConfirmationPayerNotice(context, project, (await headers()).get("host"));
}

export async function confirmAffaireBrief(input: { projectId: string; expectedUpdatedAt: string; payerNotice?: string | null }) {
  // The brief is completed by every reader of the affaire, a director included: read access is enough.
  const { context, project } = await requireAffaireAccess(input.projectId, "read");
  // One commit for the brief's compare-and-set, its event and the reservation of the affaire's automatic takeoff, which
  // engages the member's subscription only with the payer notice they were shown (launch-request-server.ts).
  const [{ confirmAffaireBriefWithTakeoff }, { headers }] = await Promise.all([
    import("@/lib/takeoff/launch-request-server"), import("next/headers"),
  ]);
  const confirmed = await confirmAffaireBriefWithTakeoff({ context, projectId: project.id, expectedUpdatedAt: input.expectedUpdatedAt,
    notice: input.payerNotice ?? null, host: (await headers()).get("host") });
  if (confirmed.outcome === "analysis_pending") return { ok: false, message: confirmed.message, takeoff: null } as const;
  if (confirmed.outcome === "not_found") {
    throw notFound("Brief affaire introuvable.");
  }
  if (confirmed.outcome === "conflict") {
    throw conflict("Le brief a changé. Actualisez avant de le confirmer.");
  }
  return {
    ok: true,
    status: "confirme",
    takeoff: confirmed.takeoff,
  } as const;
}
