import { badRequest, ok, toErrorResponse } from "@/lib/memberships/errors";
import {
  createMembershipSchema,
  membershipsListQuerySchema,
} from "@/lib/memberships/schemas";
import { createMembership, listTenantMemberships } from "@/lib/memberships/server";
import { parseJsonBody } from "@/lib/http/request";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = membershipsListQuerySchema.parse({
      search: searchParams.get("search"),
    });

    const data = await listTenantMemberships(query);
    return ok(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = createMembershipSchema.parse(await parseJsonBody(request, badRequest));
    const data = await createMembership(body);
    return ok(data, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
