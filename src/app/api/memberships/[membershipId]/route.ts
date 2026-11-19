import { badRequest, ok, toErrorResponse } from "@/lib/memberships/errors";
import { updateMembershipSchema } from "@/lib/memberships/schemas";
import { deleteMembership, updateMembership } from "@/lib/memberships/server";
import { parseJsonBody, uuidRouteParam } from "@/lib/http/request";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  try {
    const membershipId = await uuidRouteParam(params, "membershipId");
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
    const membershipId = await uuidRouteParam(params, "membershipId");
    const data = await deleteMembership(membershipId);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
