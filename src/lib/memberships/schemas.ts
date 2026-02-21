import { z } from "zod";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";

export const tenantRoleSchema = z.enum(["admin", "engineer", "viewer"]);

export const membershipsListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120, "Recherche trop longue.")
    .optional()
    .nullable(),
});

export const createMembershipSchema = z.object({
  user_id: z.string().uuid(UUID_ERROR_MESSAGE),
  role: tenantRoleSchema.default("engineer"),
});

export const updateMembershipSchema = z.object({
  role: tenantRoleSchema,
});

export type TenantRole = z.infer<typeof tenantRoleSchema>;
export type MembershipsListQueryInput = z.infer<typeof membershipsListQuerySchema>;
export type CreateMembershipInput = z.infer<typeof createMembershipSchema>;
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;
