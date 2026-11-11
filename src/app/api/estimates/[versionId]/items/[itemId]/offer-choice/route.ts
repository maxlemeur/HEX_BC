import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import { estimateOfferChoiceInputSchema } from "@/lib/estimates/offer-choice";
import { setEstimateLineOfferChoice } from "@/lib/estimates/offer-choice-server";

// TI-682, lot C, PR 4: an administrator declares (PUT) or withdraws (DELETE) the written reserve of a « Non chiffrée »
// line of a v3 draft. If-Match carries the version token; the draft lock header names this page's session.

const paramsSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  itemId: z.string().uuid("itemId invalide."),
});

async function readParams(params: Promise<{ versionId: string; itemId: string }>) {
  return paramsSchema.parse(await params);
}

function writeInput(request: Request) {
  return {
    concurrencyToken: request.headers.get("if-match")?.trim() || undefined,
    draftLockSessionId: request.headers.get(ESTIMATE_DRAFT_LOCK_SESSION_HEADER),
  };
}

export async function PUT(request: Request, { params }: { params: Promise<{ versionId: string; itemId: string }> }) {
  try {
    const { versionId, itemId } = await readParams(params);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest("Payload JSON invalide.");
    }
    const choice = estimateOfferChoiceInputSchema.parse(body);
    return ok(await setEstimateLineOfferChoice({ versionId, itemId, choice, ...writeInput(request) }));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ versionId: string; itemId: string }> }) {
  try {
    const { versionId, itemId } = await readParams(params);
    return ok(await setEstimateLineOfferChoice({ versionId, itemId, choice: null, ...writeInput(request) }));
  } catch (error) {
    return toErrorResponse(error);
  }
}
