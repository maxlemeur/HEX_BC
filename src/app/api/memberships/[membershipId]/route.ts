import { z } from "zod";

import { badRequest, ok, toErrorResponse } from "@/lib/memberships/errors";
import { updateMembershipSchema } from "@/lib/memberships/schemas";
import { deleteMembership, updateMembership } from "@/lib/memberships/server";
import { parseJsonBody } from "@/lib/http/request";

const paramsSchema = z.object({
  membershipId: z.string().uuid("membershipId invalide."),
});

async function getMembershipId(paramsPromise: Promise<{ membershipId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).membershipId;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  try {
    const membershipId = await getMembershipId(params);
    const body = updateMembershipSchema.parse(await parseJsonBody(request, badRequest));
    const data = await updateMembership(membershipId, body);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  try {
    const membershipId = await getMembershipId(params);
    const data = await deleteMembership(membershipId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
