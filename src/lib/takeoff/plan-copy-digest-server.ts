import "server-only";

import type { Database } from "@/types/database";
import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { buildPlanFileStoragePath, sanitizePlanPdfFilename } from "@/lib/takeoff/plan-file-display-name";
import { PLAN_FILE_MAX_SIZE_BYTES } from "@/lib/takeoff/plans";
import { sha256Hex } from "./sha256";

type VisibleFile = Pick<Database["public"]["Tables"]["plan_files"]["Row"], "id" | "plan_set_id" | "file_path" | "file_name" | "file_size_bytes">;

export async function readPlanCopyDigest(context: AuthenticatedTenantContext, file: VisibleFile) {
  if (file.file_size_bytes <= 0 || file.file_size_bytes > PLAN_FILE_MAX_SIZE_BYTES ||
      file.file_path !== buildPlanFileStoragePath({ tenantId: context.tenantId, setId: file.plan_set_id,
        fileId: file.id, fileName: sanitizePlanPdfFilename(file.file_name) })) return null;
  const { data, error } = await context.supabase.storage.from(PLAN_FILES_BUCKET).download(file.file_path);
  if (error || !data || data.size !== file.file_size_bytes) return null;
  return sha256Hex(new Uint8Array(await data.arrayBuffer()));
}
