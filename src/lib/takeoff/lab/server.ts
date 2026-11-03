import "server-only";

import { headers } from "next/headers";

import { assertLocalChatGptHost, getLocalChatGptCredential, getLocalChatGptState } from "@/lib/ai/chatgpt-local-auth";
import { listLocalChatGptModels } from "@/lib/ai/chatgpt-local-inference";
import { getOpenAiDecisionsCapability, OPENAI_DECISIONS_MODEL } from "@/lib/ai/decisions";
import { getUserContext } from "@/lib/auth/server";
import { readAuthenticatedUser } from "@/lib/auth/tenant-context";
import { ApiError, badRequest, conflict, forbidden, toErrorResponse } from "@/lib/estimates/errors";
import { describeError } from "@/lib/takeoff/bench/run";
import type { LabState } from "@/lib/takeoff/lab/contracts";
import { listLabDocuments } from "@/lib/takeoff/lab/dataset";
import { decisionsBudget, listLabRuns, type LabAccess } from "@/lib/takeoff/lab/runs";
import { LabFileError, readDecisionsTokenCap, readLabConfiguration, requireLabPaths } from "@/lib/takeoff/lab/storage";
import { describeLabTasks } from "@/lib/takeoff/lab/tasks";
import { listLabCampaigns } from "@/lib/takeoff/lab/verdicts";

// Server boundary of the takeoff lab (TI-661). The page and every route check,
// on the server: MergeOne local on 127.0.0.1 (assertLocalChatGptHost),
// getUserContext() and tenant_role === "admin". Routes answer 403; a redirect
// of the page authorizes nothing.

export const LAB_LOCAL_ONLY = "Le labo métré n’est disponible que dans MergeOne local, sur 127.0.0.1.";
export const LAB_ADMIN_ONLY = "Le labo métré est réservé aux administrateurs du tenant.";

export type LabPageAccess = { status: "allowed"; access: LabAccess } | { status: "refused"; message: string };

async function resolveAccess(): Promise<LabPageAccess> {
  try {
    assertLocalChatGptHost((await headers()).get("host"));
  } catch {
    return { status: "refused", message: LAB_LOCAL_ONLY };
  }
  const { user } = await readAuthenticatedUser();
  if (!user) return { status: "refused", message: LAB_ADMIN_ONLY };
  const { profile, tenantId, userEmail } = await getUserContext();
  if (!profile || !tenantId || profile.tenant_role !== "admin") return { status: "refused", message: LAB_ADMIN_ONLY };
  return { status: "allowed", access: { owner: { userId: user.id, tenantId }, email: userEmail || null } };
}

/** For the page: the refusal is rendered, never turned into an authorization. */
export async function readTakeoffLabPageAccess() {
  return resolveAccess();
}

/** For the routes: 403 unless local host and tenant admin. */
export async function requireTakeoffLabAccess(): Promise<LabAccess> {
  const result = await resolveAccess();
  if (result.status !== "allowed") {
    throw forbidden(result.message, undefined, result.message === LAB_LOCAL_ONLY ? "TAKEOFF_LAB_LOCAL_ONLY" : "TAKEOFF_LAB_ADMIN_ONLY");
  }
  return result.access;
}

/**
 * For the routes that write or spend (POST runs, PUT verdicts, POST undo): the
 * lab's own pages only. A page of another port of 127.0.0.1 is same-site for the
 * session cookies; its forged request carries another Origin (or none) and is
 * refused before any parsing, as are bodies that are not application/json.
 */
export async function requireTakeoffLabWrite(request: Request, options: { json: boolean }): Promise<LabAccess> {
  const access = await requireTakeoffLabAccess();
  const origin = assertLocalChatGptHost((await headers()).get("host"));
  if (request.headers.get("origin") !== origin) {
    throw forbidden("Origine de requête refusée : le labo n’accepte que ses propres pages.", undefined, "TAKEOFF_LAB_ORIGIN");
  }
  if (options.json && request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw badRequest("Corps JSON requis (application/json).");
  }
  return access;
}

export function labErrorResponse(error: unknown) {
  if (error instanceof LabFileError) return toErrorResponse(new ApiError({ status: 500, code: "TAKEOFF_LAB_FILE", message: error.message }));
  return toErrorResponse(error);
}

export async function readLabState(access: LabAccess): Promise<LabState> {
  const configuration = readLabConfiguration();
  const capability = getOpenAiDecisionsCapability();
  const cap = readDecisionsTokenCap();
  let runs: Awaited<ReturnType<typeof listLabRuns>> = [];
  let campaigns: string[] = [];
  let message = configuration.status === "configured" ? null : configuration.message;
  if (configuration.status === "configured") {
    try {
      const paths = await requireLabPaths();
      [runs, campaigns] = await Promise.all([listLabRuns(paths), listLabCampaigns(paths)]);
    } catch (error) {
      message = error instanceof ApiError || error instanceof LabFileError ? error.message : describeError(error).message;
    }
  }
  const listing = await listLabDocuments();
  // A dataset path that is set but unreadable degrades like an absent one: fixtures only, named reason.
  if (listing.error) message = listing.error;
  const chatgpt = await getLocalChatGptState(access.owner).catch(() => null);
  const decisionsMessage = cap === null ? "TAKEOFF_LAB_DECISIONS_MAX_TOKENS doit être un entier positif : Decisions désactivé." : capability.message;
  return {
    configured: configuration.status === "configured" && message === null,
    message,
    documents: listing.documents,
    tasks: describeLabTasks(),
    decisions: { available: capability.status === "available" && cap !== null, message: decisionsMessage, model: OPENAI_DECISIONS_MODEL,
      budget: decisionsBudget(runs, cap) },
    chatgpt: {
      connected: Boolean(chatgpt?.sharing), model: chatgpt?.model ?? null, reasoning_effort: chatgpt?.reasoningEffort ?? null,
      message: !chatgpt?.sharing ? "Connectez votre compte ChatGPT dans Mon profil." : !chatgpt.model ? "Choisissez un modèle ChatGPT dans Mon profil : le labo ne modifie jamais le profil." : null,
    },
    campaigns,
    latest_campaign: runs[0]?.campaign ?? null,
  };
}

/** The account's models, read only: refused while the profile has no model (listLocalChatGptModels would write one). */
export async function readLabChatGptModels(access: LabAccess) {
  const credential = await getLocalChatGptCredential(access.owner).catch((error) => {
    throw conflict(describeError(error).message, undefined, "TAKEOFF_LAB_CHATGPT");
  });
  if (!credential) throw conflict("Connectez votre compte ChatGPT dans Mon profil.", undefined, "TAKEOFF_LAB_CHATGPT");
  if (!credential.model) throw conflict("Choisissez un modèle ChatGPT dans Mon profil : le labo ne modifie jamais le profil.", undefined, "TAKEOFF_LAB_CHATGPT");
  const models = await listLocalChatGptModels(access.owner).catch((error) => {
    throw conflict(describeError(error).message, undefined, "TAKEOFF_LAB_CHATGPT");
  });
  return { models, profile: { model: credential.model, reasoning_effort: credential.reasoningEffort } };
}
