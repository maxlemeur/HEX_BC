import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import {
  ESTIMATE_DRAFT_LOCK_SESSION_HEADER,
  normalizeEstimateDraftLockSessionId,
} from "@/lib/estimates/lock-session";
import { acquireLock, releaseLock, renewLock } from "@/lib/estimates/locks";

const versionIdParamSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
});

async function getVersionId(paramsPromise: Promise<{ versionId: string }>) {
  const params = await paramsPromise;
  return versionIdParamSchema.parse(params).versionId;
}

function getSessionId(request: Request) {
  const sessionId = normalizeEstimateDraftLockSessionId(
    request.headers.get(ESTIMATE_DRAFT_LOCK_SESSION_HEADER)
  );

  if (!sessionId) {
    throw badRequest("Identifiant de page d'édition invalide.");
  }

  return sessionId;
}

function parseForceQuery(request: Request) {
  const rawValue = new URL(request.url).searchParams.get("force");
  if (!rawValue) {
    return false;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }

  if (normalized === "0" || normalized === "false") {
    return false;
  }

  throw badRequest("Parametre force invalide.");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const sessionId = getSessionId(request);
    const data = await acquireLock(versionId, sessionId);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const sessionId = getSessionId(request);
    const force = parseForceQuery(request);
    const data = await renewLock(versionId, sessionId, {
      force,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> }
) {
  try {
    const versionId = await getVersionId(params);
    const sessionId = getSessionId(request);
    const force = parseForceQuery(request);
    const data = await releaseLock(versionId, sessionId, {
      force,
    });
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
