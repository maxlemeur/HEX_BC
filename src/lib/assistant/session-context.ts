import { z } from "zod";

import { assistantScreenSchema } from "./prompt";

export const ASSISTANT_HISTORY_LIMIT = 8;
export const ASSISTANT_HISTORY_MESSAGE_LIMIT = 2_000;

export const assistantSessionContextSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["help", "affaires", "estimates", "catalogue", "workbook", "prices", "suppliers", "approvals"]) }).strict(),
  z.object({ kind: z.literal("orders"), orderId: z.string().uuid().optional() }).strict(),
  z.object({ kind: z.literal("project"), projectId: z.string().uuid(), screen: assistantScreenSchema }).strict(),
  z.object({ kind: z.literal("estimate"), versionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("materials"), projectId: z.string().uuid(), requestId: z.string().uuid().optional() }).strict(),
]);

export type AssistantSessionContext = z.infer<typeof assistantSessionContextSchema>;
export type AssistantSourceLink = { href: string; label: string };

export const ASSISTANT_CONTEXT_LABELS: Record<AssistantSessionContext["kind"], string> = {
  help: "Aide générale", affaires: "Affaires", estimates: "Devis", catalogue: "Catalogue",
  workbook: "Import du classeur", prices: "Tarifs", suppliers: "Fournisseurs", approvals: "Validation",
  orders: "Commandes", project: "Affaire", estimate: "Devis", materials: "Demandes de matériel",
};

export function assistantContextForPath(pathname: string): AssistantSessionContext {
  const [, , section, id, subsection, item] = pathname.split("/");
  const context = (() => {
    switch (section) {
      case "affaires":
        if (!id || id === "new") return { kind: "affaires" };
        if (subsection === "demandes-materiel") return { kind: "materials", projectId: id, requestId: item };
        if (subsection === "takeoff") return { kind: "project", projectId: id, screen: { screen: "takeoff_review", jobId: item } };
        return { kind: "project", projectId: id, screen: { screen: "affaire" } };
      case "estimates": return id && z.uuid().safeParse(id).success ? { kind: "estimate", versionId: id } : { kind: "estimates" };
      case "products": return { kind: id === "import-workbook" ? "workbook" : "catalogue" };
      case "catalogue":
      case "referentiel": return { kind: "catalogue" };
      case "prices":
      case "tarifs": return { kind: "prices" };
      case "suppliers": return { kind: "suppliers" };
      case "orders": return { kind: "orders", orderId: id === "new" ? undefined : id };
      case "approvals": return { kind: "approvals" };
      default: return { kind: "help" };
    }
  })();
  const parsed = assistantSessionContextSchema.safeParse(context);
  return parsed.success ? parsed.data : { kind: "help" };
}
