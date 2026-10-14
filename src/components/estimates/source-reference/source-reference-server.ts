import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import type { SourceReferenceReview } from "@/lib/estimates/source-reference-contracts";
import type { SourceReferenceDocuments } from "./source-reference-state";

const documentSchema = z.strictObject({
  id: z.string().uuid(),
  file_name: z.string().min(1),
  created_at: z.iso.datetime({ offset: true }),
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

// The intake tables predate the generated Database surface. Keep this read-only
// projection local and validate every returned row; never import the AI intake service.
type IntakeReadDatabase = {
  public: {
    Tables: {
      affaire_intake_documents: {
        Row: z.infer<typeof documentSchema> & { tenant_id: string; project_id: string; document_kind: string; upload_status: string; mime_type: string | null };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

export async function readSourceReferenceDocuments(
  context: AuthenticatedTenantContext,
  review: SourceReferenceReview,
  page: number
): Promise<SourceReferenceDocuments> {
  const base = { items: [], page, hasNext: false };
  if (context.tenantRole !== "admin" && context.tenantRole !== "engineer") return { ...base, state: "readonly" };

  const version = await context.supabase.from("estimate_versions")
    .select("status").eq("id", review.versionId).eq("tenant_id", context.tenantId).eq("project_id", review.projectId).maybeSingle();
  if (version.error || !version.data) return { ...base, state: "error" };
  if (version.data.status !== "draft") return { ...base, state: "readonly" };

  const client = context.supabase as unknown as SupabaseClient<IntakeReadDatabase>;
  const offset = (page - 1) * 20;
  const result = await client.from("affaire_intake_documents")
    .select("id, file_name, created_at, size_bytes")
    .eq("tenant_id", context.tenantId).eq("project_id", review.projectId)
    .eq("document_kind", "cctp").eq("upload_status", "uploaded")
    .or("mime_type.eq.application/pdf,file_name.ilike.%.pdf")
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(offset, offset + 20);
  if (result.error) return { ...base, state: "error" };
  const parsed = z.array(documentSchema).max(21).safeParse(result.data);
  if (!parsed.success) return { ...base, state: "error" };
  return {
    page, state: "ready", hasNext: parsed.data.length > 20,
    items: parsed.data.slice(0, 20).map((row) => ({ id: row.id, fileName: row.file_name, createdAt: row.created_at, byteSize: row.size_bytes })),
  };
}
