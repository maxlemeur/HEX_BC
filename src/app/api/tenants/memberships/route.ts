import { badRequest, ok, toErrorResponse } from "@/lib/memberships/errors";
import { tenantMembershipActionSchema } from "@/lib/memberships/schemas";
import {
  listTenantSettingsMemberships,
  setDefaultMembership,
  updateTenantSettingsMembershipRole,
} from "@/lib/memberships/server";
import { parseJsonBody } from "@/lib/http/request";

export async function GET() {
  try {
    return ok(await listTenantSettingsMemberships());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = tenantMembershipActionSchema.parse(await parseJsonBody(request, badRequest));
    return ok(payload.action === "set-role"
      ? await updateTenantSettingsMembershipRole(payload.membership_id, payload.role)
      : await setDefaultMembership(payload.membership_id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
