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

export async function confirmAffaireBrief(input: { projectId: string; expectedUpdatedAt: string }) {
  // The brief is completed by every reader of the affaire, a director included: read access is enough.
  const { context, project } = await requireAffaireAccess(input.projectId, "read");
  const existing = await fetchAffaireBriefForProject({
    supabase: context.supabase,
    projectId: project.id,
  });

  if (!existing) {
    throw notFound("Brief affaire introuvable.");
  }

  if (existing.brief.updated_at !== input.expectedUpdatedAt) {
    throw conflict("Le brief a changé. Actualisez avant de le confirmer.");
  }

  if (existing.draft.status === "confirme") {
    // A replay of the gesture records the confirmer's mandate if the first call could not (the database keeps one).
    return {
      ok: true,
      status: "confirme",
      takeoff: await recordAutomaticTakeoffStart(context, project.id),
    } as const;
  }

  const confirmedAt = new Date().toISOString();
  const { data, error } = await resolveSupabaseQuery<{ data: { id: string } | null; error: unknown }>(
    context.supabase
      .from("affaire_briefs")
      .update({
        status: "confirme", confirmed_at: confirmedAt, confirmed_by: context.userId, updated_by: context.userId,
      } as never)
      .eq("id", existing.brief.id)
      .eq("updated_at", input.expectedUpdatedAt)
      .select("id" as never)
      .maybeSingle()
  );
  if (error) throw internalError("Impossible de confirmer le brief affaire.", error);
  if (!data) throw conflict("Le brief a changé. Actualisez avant de le confirmer.");

  await insertAffaireIntakeEvent({
    supabase: context.supabase,
    uploadId: existing.brief.upload_id,
    actorUserId: context.userId,
    eventType: "brief.confirmed",
    beforePayload: {
      status: existing.draft.status,
    },
    afterPayload: {
      status: "confirme",
      confirmed_at: confirmedAt,
    },
  });

  return {
    ok: true,
    status: "confirme",
    takeoff: await recordAutomaticTakeoffStart(context, project.id),
  } as const;
}

/**
 * The automatic start of the takeoff, once the confirmation committed: the affaire's one request is reserved and the
 * member who confirmed is recorded as its payer, or the reason why the analysis cannot start (it is visible on the
 * affaire, never silent). The brief stays confirmed whatever happens here.
 */
async function recordAutomaticTakeoffStart(context: Awaited<ReturnType<typeof requireAffaireAccess>>["context"], projectId: string) {
  try {
    const [{ recordAutomaticTakeoffMandate }, { headers }] = await Promise.all([
      import("@/lib/takeoff/launch-request-server"), import("next/headers"),
    ]);
    return await recordAutomaticTakeoffMandate({ context, projectId, host: (await headers()).get("host") });
  } catch (error) {
    console.error("takeoff.launch_request.mandate_failed", { projectId, code: (error as { code?: string })?.code ?? null });
    return null;
  }
}
