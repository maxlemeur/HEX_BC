import type { Database } from "@/types/database";

import { forbidden } from "./errors";

type TenantRole = Database["public"]["Enums"]["tenant_role"];

export function canWriteEstimateWorkflows(role: TenantRole) {
  return role === "admin" || role === "engineer";
}

export function assertCanWriteEstimateWorkflows(role: TenantRole) {
  if (canWriteEstimateWorkflows(role)) {
    return;
  }

  throw forbidden(
    "Cette action est reservee aux administrateurs et aux chiffreurs.",
    undefined,
    "ESTIMATE_WRITE_ROLE_REQUIRED"
  );
}
