import { z } from "zod";

const UUID_ERROR_MESSAGE = "Identifiant invalide.";

export const ordersListQuerySchema = z
  .object({
    view: z.enum(["list", "items"]).optional().default("list"),
    order_id: z.array(z.string().uuid(UUID_ERROR_MESSAGE)).max(1000).default([]),
  })
  .superRefine((query, context) => {
    // `view=items` is a per-order detail fetch: never return every item of the tenant.
    if (query.view === "items" && query.order_id.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["order_id"],
        message: "Au moins un identifiant de commande est requis.",
      });
    }
  });

export type OrdersListQueryInput = z.infer<typeof ordersListQuerySchema>;
