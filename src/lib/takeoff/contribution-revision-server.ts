import "server-only";

import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { mapItemSendRpcError } from "@/lib/takeoff/item-send-confirm-server";
import { takeoffModuleDefault } from "@/lib/takeoff/feature-flags";
import {
  computeItemSendState,
  itemSendChoicesDigest,
  itemSendMemberMayWrite,
} from "@/lib/takeoff/item-send-preview-server";
import {
  revisionRequestSchema,
  revisionResponseSchema,
  revisionPreviewSchema,
  revisionReadSchema,
} from "@/lib/takeoff/contribution-revision-contracts";
import { parseTakeoffCountMarkEditResult, takeoffCountMarkEditRefusal } from "@/lib/takeoff/count-marks";
import { throwMarkEditRefusal } from "@/lib/takeoff/count-marks-server";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import type { Json } from "@/types/database.generated";

const messages: Record<string, string> = {
  TAKEOFF_REVISION_SCOPE: "Vous ne pouvez pas corriger cet envoi dans ce devis.",
  REDISTRIBUTION_FORBIDDEN: "Vous ne pouvez pas modifier les apports de cette affaire.",
  TAKEOFF_REVISION_STALE: "L’aperçu a changé. Relisez les quantités avant de confirmer.",
  TAKEOFF_REVISION_SEALED: "Le devis a été émis ou scellé. Ses apports sont en lecture seule.",
  TAKEOFF_REVISION_ENGINE: "La correction demande un brouillon du moteur de calcul 3.",
  TAKEOFF_REVISION_INVALID: "Un choix ne s’applique plus à cet envoi. Relisez l’aperçu.",
  TAKEOFF_REVISION_INTENT_CONFLICT: "Cette confirmation a déjà servi pour une autre correction.",
  TAKEOFF_REVISION_SOURCE_UNAVAILABLE:
    "Cette quantité ne peut pas être retenue. Vérifiez son unité, les anomalies et la référence DPGF.",
  TAKEOFF_REVISION_HYPOTHESIS_REQUIRED: "Seule une hypothèse en attente peut être incluse.",
  TAKEOFF_REVISION_ENTRY_PROTECTED: "La saisie de l’affaire ou une hypothèse en attente protège cette quantité.",
  TAKEOFF_REVISION_LEASE: "Réservez le brouillon pour confirmer la correction.",
  TAKEOFF_REVISION_DECISION_REQUIRED: "Un poste attend encore votre décision.",
  REDISTRIBUTION_OTHER_AMOUNTS:
    "Le recalcul modifierait le montant d’une autre ligne. Vérifiez le brouillon dans l’éditeur.",
  TAKEOFF_ITEM_SEND_PREVIEW_STALE: "La destination ou les apports ont changé. Relisez l’aperçu.",
  TAKEOFF_REVISION_FOREIGN_PART: "La correction laisserait de côté un apport d’une autre analyse.",
};
function refuse(reason: string): never {
  const denied = reason === "TAKEOFF_REVISION_SCOPE" || reason === "REDISTRIBUTION_FORBIDDEN";
  throw new TakeoffError({
    status: denied ? 403 : messages[reason] ? 409 : 500,
    code: denied
      ? TakeoffErrorCode.FORBIDDEN
      : messages[reason]
        ? TakeoffErrorCode.CONFLICT
        : TakeoffErrorCode.INTERNAL_ERROR,
    message: messages[reason] ?? "Impossible de vérifier la correction de cet envoi.",
    details: { reason },
  });
}

export async function reviseContribution(rawJobId: string, body: unknown) {
  const ctx = await getAuthenticatedTakeoffContext();
  const jobId = parseWithSchema(takeoffJobIdSchema, rawJobId, "Identifiant de lecture invalide.");
  const request = parseWithSchema(revisionRequestSchema, body, "Demande de correction invalide.");
  const job = await ctx.supabase
    .from("takeoff_jobs")
    .select("project_id,estimate_version_id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", jobId)
    .maybeSingle();
  if (job.error) refuse("read");
  if (!job.data?.project_id) refuse("TAKEOFF_REVISION_SCOPE");
  const project = job.data.project_id;
  const receipts = () =>
    ctx.supabase
      .from("takeoff_item_send_receipts")
      .select("id,version_id,estimate_versions!inner(version_number,status,currency)")
      .eq("tenant_id", ctx.tenantId)
      .eq("project_id", project)
      .or(`job_id.eq.${jobId},write_plan->>source_job_id.eq.${jobId}`);
  if (request.action === "read") {
    const versions = new Map<string, { version_number: number; status: string }>();
    for (let offset = 0; ; offset += 500) {
      const rows = await receipts()
        .order("id")
        .range(offset, offset + 499);
      if (rows.error || !rows.data) refuse("read");
      for (const row of rows.data) versions.set(row.version_id, row.estimate_versions);
      if (rows.data.length < 500) break;
    }
    const results = await Promise.all(
      Array.from(versions, async ([version, meta]) => {
        const read = await ctx.supabase.rpc("read_takeoff_contribution_revision", {
          p_tenant: ctx.tenantId,
          p_project: project,
          p_version: version,
          p_job: jobId,
          p_items: request.items,
        });
        if (read.error) refuse(read.error.message);
        return { ...revisionReadSchema.parse(read.data), ...meta };
      }),
    );
    return revisionResponseSchema.parse({
      action: "read",
      versions: results.sort(
        (a, b) =>
          Number(b.version_id === job.data?.estimate_version_id) -
            Number(a.version_id === job.data?.estimate_version_id) || b.version_number - a.version_number,
      ),
    });
  }
  const member = { ...ctx, tenantRole: ctx.tenantRole ?? "" };
  if (!(await itemSendMemberMayWrite(member, project, jobId))) refuse("TAKEOFF_REVISION_SCOPE");
  const addressed = await receipts()
    .eq("version_id", request.version_id)
    .eq("id", request.receipt_id)
    .maybeSingle();
  if (addressed.error) refuse("read");
  if (!addressed.data) refuse("TAKEOFF_REVISION_SCOPE");
  const currency = addressed.data.estimate_versions.currency;
  const scope = {
    p_tenant: ctx.tenantId,
    p_project: project,
    p_version: request.version_id,
    p_receipt: request.receipt_id,
  };
  const memberScope = {
    p_tenant_id: scope.p_tenant,
    p_project_id: project,
    p_version_id: scope.p_version,
    p_receipt_id: scope.p_receipt,
  };
  if (request.action === "marks") {
    const command = request.command;
    const result = await ctx.supabase.rpc("edit_takeoff_revision_marks", {
      ...memberScope,
      p_intent_key: command.intentKey,
      p_revisions: Object.fromEntries(
        Object.entries(command.revisions).map(([key, val]) => [key.toLowerCase(), val]),
      ),
      p_gestures: command.gestures as unknown as Json,
    });
    if (result.error) {
      if (takeoffCountMarkEditRefusal(result.error.message)) throwMarkEditRefusal(result.error);
      refuse(result.error.message);
    }
    return revisionResponseSchema.parse({ action: "marks", result: parseTakeoffCountMarkEditResult(result.data) });
  }
  if (request.action === "choose" || request.action === "entry") {
    const result =
      request.action === "entry"
        ? await ctx.supabase.rpc("edit_takeoff_revision_entry", {
            ...scope,
            p_answer: request.answer_id,
            p_intent: request.intent_id,
            p_expected_revision: request.expected_revision,
            p_entry: request.entry,
          })
        : await ctx.supabase.rpc("review_takeoff_revision_item", {
            ...memberScope,
            p_answer_id: request.answer_id,
            p_intent_id: request.intent_id,
            p_expected: request.expected,
            p_choice: request.choice,
          });
    if (result.error) refuse(result.error.message);
    return revisionResponseSchema.parse({
      action: request.action,
      ...z.object({ replayed: z.boolean() }).parse(result.data),
    });
  }

  const service = createServiceRoleClient();
  const args = { ...scope, p_actor: ctx.userId, p_module: takeoffModuleDefault() };
  const { additions, ...selections } = request.choices;
  const choices: Record<string, Json> = { ...selections };
  if (selections.page_decisions)
    choices.page_decisions = selections.page_decisions.map((d) => ({
      ...d,
      note: d.decision === "keep_both" ? (d.note ?? null) : null,
    }));
  const plannerRequest = {
    ...additions,
    destination: { kind: "existing_draft" as const, version_id: scope.p_version },
  };
  async function preview() {
    const result = await service.rpc("preview_takeoff_contribution_revision", { ...args, p_choices: choices });
    if (result.error) refuse(result.error.message);
    const raw = z
      .object({
        blockers: z.array(
          z
            .object({ reason: z.string(), code: z.string().optional(), detail: z.string().nullable().optional() })
            .passthrough(),
        ),
      })
      .passthrough()
      .parse(result.data);
    const blockers = raw.blockers.map((b) =>
      b.reason === "addition_refused" && b.code
        ? {
            ...b,
            message:
              messages[b.code] ?? mapItemSendRpcError({ message: b.code, details: b.detail }, jobId).message,
            send_code: b.code,
          }
        : b,
    );
    return revisionPreviewSchema.parse({ ...raw, currency, blockers });
  }
  async function plan() {
    const initial = await preview();
    if (!initial.additions.length) return initial;
    const state = await computeItemSendState(
      member,
      jobId,
      plannerRequest,
      initial.changes.filter((c) => initial.additions.includes(c.item_id)),
    );
    if (!state.writePlan) return { ...initial, addition_preview: state.response };
    choices.send_plan = state.writePlan as unknown as Json;
    return { ...(await preview()), addition_preview: state.response };
  }
  if (request.action === "preview")
    return revisionResponseSchema.parse({ action: "preview", preview: await plan() });
  // Rebuild additions with the ordinary planner for a new confirmation. Recover
  // its exact prior plan for a retry even if the destination has since been issued.
  const intent = request.intent_id;
  const digest = request.digest;
  async function recoverSubmittedPlan() {
    const prior = await ctx.supabase
      .from("takeoff_item_send_receipts")
      .select("write_plan")
      .eq("tenant_id", ctx.tenantId)
      .eq("project_id", project)
      .eq("version_id", scope.p_version)
      .eq("amends_receipt_id", scope.p_receipt)
      .eq("actor_id", ctx.userId)
      .eq("request_id", intent)
      .eq("plan_sha256", digest)
      .eq("command_kind", "revise")
      .maybeSingle();
    if (prior.error) refuse("read");
    if (prior.data) {
      const stored = z
        .object({
          choices: z.object({ send_plan: z.object({ choices_sha256: z.string() }).passthrough().optional() }),
        })
        .parse(prior.data.write_plan);
      if (stored.choices.send_plan) {
        if (stored.choices.send_plan.choices_sha256 !== itemSendChoicesDigest(plannerRequest))
          refuse("TAKEOFF_REVISION_INTENT_CONFLICT");
        choices.send_plan = stored.choices.send_plan as Json;
      }
      return true;
    }
    return false;
  }
  if (!(await recoverSubmittedPlan())) {
    try {
      await plan();
    } catch (error) {
      // A concurrent identical confirmation may have advanced the receipt head
      // between the lookup and the preview. The writer still checks the digest.
      if (!(await recoverSubmittedPlan())) throw error;
    }
  }
  const result = await service.rpc("confirm_takeoff_contribution_revision", {
    ...args,
    p_intent: request.intent_id,
    p_digest: request.digest,
    p_choices: choices,
  });
  if (result.error) refuse(result.error.message);
  return revisionResponseSchema.parse({
    action: "confirm",
    ...z.object({ receipt_id: z.string().uuid(), replayed: z.boolean() }).parse(result.data),
  });
}
