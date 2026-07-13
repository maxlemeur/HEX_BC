import { describe, expect, it } from "vitest";

import { isAuthorizedWorkerRelayRequest } from "../../../supabase/functions/process_takeoff_job/security";

describe("process_takeoff_job relay authorization", () => {
  const serviceRoleKey = "service-role-secret";

  it("rejects a normal authenticated bearer token", () => {
    const request = new Request(
      "http://localhost/functions/v1/process_takeoff_job",
      {
        headers: {
          Authorization: "Bearer authenticated-user-jwt",
          apikey: "public-anon-key",
        },
      }
    );

    expect(isAuthorizedWorkerRelayRequest(request, serviceRoleKey)).toBe(false);
  });

  it("rejects partial service-role credentials", () => {
    const request = new Request(
      "http://localhost/functions/v1/process_takeoff_job",
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: "public-anon-key",
        },
      }
    );

    expect(isAuthorizedWorkerRelayRequest(request, serviceRoleKey)).toBe(false);
  });

  it("accepts the server-side service-role relay", () => {
    const request = new Request(
      "http://localhost/functions/v1/process_takeoff_job",
      {
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
      }
    );

    expect(isAuthorizedWorkerRelayRequest(request, serviceRoleKey)).toBe(true);
  });
});
